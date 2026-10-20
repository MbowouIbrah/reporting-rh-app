"""Cycle de vie d'un lot : analyse (staging) -> validation explicite -> annulation."""

import hashlib
from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal

from fastapi import HTTPException
from openpyxl.comments import Comment
from openpyxl.styles import Font, PatternFill
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.orm import Session

from app.imports.lecture import Feuille, FichierIllisible, lire
from app.imports.regles import (
    ATTRIBUTS,
    BLOQUANT,
    BRUT,
    CODES_FORMULE,
    COMPOSANTES_BRUT,
    FACTEURS,
    MOIS,
    Refs,
    colonnes,
    employe_probable,
    entetes_reconnus,
    est_sans_matricule,
    fr,
    interpretations,
    nombre,
    norm,
    somme_brut,
    texte,
    valider,
)
from app.imports.similarite import SEUIL_NOUVEAU_PROCHE, plus_proche, similarite
from app.models.auth import AuditEvent
from app.models.donnees import Montant, Periode, Salarie, SituationMensuelle
from app.models.imports import ImportAnomalie, LotImport, LotImportPrecedent, StagingLigne
from app.models.referentiel import (
    TYPES_SITE,
    Activite,
    Poste,
    RefAlias,
    Rubrique,
    Service,
    Site,
    TypeContrat,
)
from app.security import audit

DIM_MODELS = {"service": Service, "activite": Activite, "site": Site,
              "type_contrat": TypeContrat, "poste": Poste}


def _now() -> datetime:
    return datetime.now(UTC)


def charger_refs(db: Session) -> Refs:
    def libelles(model):
        return {r.id: r.libelle for r in db.scalars(select(model))}

    def index(dimension, model):
        base = libelles(model)
        idx = {norm(v): v for v in base.values()}
        for a in db.scalars(select(RefAlias).where(RefAlias.dimension == dimension)):
            if a.cible_id in base:
                idx[a.alias_norm] = base[a.cible_id]
        return idx

    rubs = list(db.scalars(select(Rubrique).where(Rubrique.actif).order_by(Rubrique.ordre)))
    par_id = {r.id: r.libelle for r in rubs}
    alias = {a.alias_norm: par_id[a.cible_id]
             for a in db.scalars(select(RefAlias).where(RefAlias.dimension == "rubrique"))
             if a.cible_id in par_id}
    salaries = list(db.scalars(select(Salarie)))
    noms = {s.matricule_norm: norm(s.nom) for s in salaries if s.nom}
    lib = {c: libelles(m) for c, (_d, m, _f) in COLONNES_REF.items()}
    historique: dict[str, list] = {}
    for r in db.execute(select(Salarie.matricule_norm, Periode.annee, Periode.mois,
                               *(getattr(SituationMensuelle, f) for _d, _m, f in COLONNES_REF.values()))
                        .join(SituationMensuelle, SituationMensuelle.salarie_id == Salarie.id)
                        .join(Periode, Periode.id == SituationMensuelle.periode_id)
                        .order_by(Periode.annee, Periode.mois)):
        historique.setdefault(r[0], []).append(
            (r[1], r[2], {c: lib[c].get(i) for c, i in zip(COLONNES_REF, r[3:], strict=True)}))
    montants: dict[tuple[str, int, int], dict[str, Decimal]] = {}
    for m, a, mo, rub, v in db.execute(
            select(Salarie.matricule_norm, Periode.annee, Periode.mois, Montant.rubrique_id, Montant.valeur)
            .join(SituationMensuelle, SituationMensuelle.salarie_id == Salarie.id)
            .join(Periode, Periode.id == SituationMensuelle.periode_id)
            .join(Montant, Montant.situation_id == SituationMensuelle.id)):
        if rub in par_id:
            montants.setdefault((m, a, mo), {})[par_id[rub]] = v
    return Refs(
        services=index("service", Service), activites=index("activite", Activite),
        sites=index("site", Site), contrats=index("type_contrat", TypeContrat),
        rubriques=[(r.libelle, r.unite) for r in rubs], rubrique_alias=alias,
        postes=set(index("poste", Poste)), noms_connus=noms,
        annuaire={s.matricule_norm: (s.matricule, s.nom) for s in salaries if s.nom},
        historique=historique, montants=montants,
    )


def lot_dict(lot: LotImport) -> dict:
    return {
        "id": lot.id, "fichier_nom": lot.fichier_nom, "sha256": lot.sha256, "statut": lot.statut,
        "cree_le": lot.cree_le.isoformat() if lot.cree_le else None,
        "valide_le": lot.valide_le.isoformat() if lot.valide_le else None,
        "annule_le": lot.annule_le.isoformat() if lot.annule_le else None,
        "nb_lignes": lot.nb_lignes, "nb_bloquants": lot.nb_bloquants, "nb_avert": lot.nb_avert,
        "stats": lot.stats,
    }


ACTIONS_MODIF = ("import_correction", "import_ajout_referentiel", "import_ligne_retiree", "import_ignore")


def _nb_modifications(db: Session, lot: LotImport) -> int:
    return db.scalar(select(func.count()).select_from(AuditEvent).where(
        AuditEvent.entite == "lot_import", AuditEvent.entite_id == str(lot.id),
        AuditEvent.action.in_(ACTIONS_MODIF))) or 0


def analyser(db: Session, user_id: int, nom: str, contenu: bytes, reprise: str | None = None) -> LotImport:
    """Fichier déjà en vérification : avec des modifications enregistrées, `reprise` choisit de les
    reprendre (« reprendre ») ou de tout annuler (« recommencer ») ; sans modification, l'ancien lot
    est abandonné et le fichier analysé comme neuf."""
    sha = hashlib.sha256(contenu).hexdigest()
    lots = list(db.scalars(select(LotImport).where(LotImport.sha256 == sha).order_by(LotImport.id.desc())))
    valide = next((x for x in lots if x.statut == "valide"), None)
    if valide is not None:
        raise HTTPException(409, {"message": "Fichier déjà importé", "lot_id": valide.id})
    en_cours = [x for x in lots if x.statut in ("pret", "rejete")]
    repris = next((x for x in en_cours if x.feuille and _nb_modifications(db, x)), None)
    if repris is not None and reprise not in ("reprendre", "recommencer"):
        raise HTTPException(409, {"message": "Vérification en cours pour ce fichier", "lot_id": repris.id,
                                  "reprise": True, "modifications": _nb_modifications(db, repris)})
    if reprise != "reprendre":
        repris = None
    for x in en_cours:
        if x is not repris:
            x.statut, x.annule_par, x.annule_le = "annule", user_id, _now()
            audit.record(db, user_id, "import_abandonne", "lot_import", x.id, None, {"statut": "annule"})
    if repris is not None:
        # Contrôles relancés avec les règles du jour ; les modifications enregistrées sont gardées.
        _relancer(db, repris, _feuille_du_lot(repris), _refs_du_lot(db, repris))
        db.commit()
        return repris
    db.flush()
    refs = charger_refs(db)
    try:
        feuille = lire(contenu, entetes_reconnus(refs))
    except FichierIllisible as e:
        raise HTTPException(422, str(e)) from None
    return analyser_feuille(db, user_id, nom, feuille, sha, len(contenu), refs)


def analyser_feuille(db: Session, user_id: int, nom: str, feuille: Feuille, sha: str,
                     taille: int, refs: Refs | None = None) -> LotImport:
    lignes, anos, stats = valider(feuille, refs or charger_refs(db))
    lot = LotImport(fichier_nom=nom[:255], sha256=sha, taille=taille, cree_par=user_id,
                    statut=_statut(anos), feuille=_feuille_json(feuille))
    db.add(lot)
    db.flush()
    _ecrire(db, lot, lignes, anos, stats)
    audit.record(db, user_id, "import_analyse", "lot_import", lot.id, None,
                 {"statut": lot.statut, "fichier": lot.fichier_nom, **(stats or {})})
    db.commit()
    return lot


def _statut(anos) -> str:
    return "rejete" if any(a.gravite == BLOQUANT for a in anos) else "pret"


def _feuille_json(f: Feuille) -> dict:
    """Valeurs JSON telles quelles ; une date ou une heure est gardée comme la lisent les règles (texte)."""
    def v(x):
        return x if x is None or isinstance(x, str | int | float | bool) else str(x)
    return {"entete_ligne": f.entete_ligne, "entetes": [v(x) for x in f.entetes],
            "lignes": [[n, [v(x) for x in row]] for n, row in f.lignes], "ligne_ignoree": f.ligne_ignoree,
            "formules": [[n, j, t] for n, fs in f.formules.items() for j, t in fs.items()]}


def _ecrire(db: Session, lot: LotImport, lignes, anos, stats) -> None:
    """Lignes et points du lot remplacés par le résultat des contrôles, compteurs et statut à jour."""
    nb_b = sum(1 for a in anos if a.gravite == BLOQUANT)
    lot.statut, lot.nb_lignes, lot.nb_bloquants, lot.nb_avert, lot.stats = (
        _statut(anos), len(lignes), nb_b, len(anos) - nb_b, stats)
    db.execute(delete(StagingLigne).where(StagingLigne.lot_id == lot.id))
    db.execute(delete(ImportAnomalie).where(ImportAnomalie.lot_id == lot.id))
    if lignes:
        db.execute(insert(StagingLigne), [{
            "lot_id": lot.id, "num_ligne": L.num, "annee": L.annee, "mois": L.mois,
            "matricule": L.matricule, "bloquant": L.bloquant,
            "donnees": {"nom": L.nom, "poste": L.poste, "service": L.service, "site": L.site,
                        "activite": L.activite, "type_contrat": L.type_contrat,
                        "montants": {k: str(v) for k, v in L.montants.items()}},
        } for L in lignes])
    if anos:
        db.execute(insert(ImportAnomalie), [{
            "lot_id": lot.id, "num_ligne": a.ligne, "colonne": a.colonne, "code": a.code,
            "gravite": a.gravite, "valeur": a.valeur, "message": a.message} for a in anos])


def _saisie(v: str | None, numerique: bool):
    """Valeur saisie dans l'écran : un nombre est rangé comme un nombre d'Excel, pas comme du texte."""
    s = texte(v)
    if not s:
        return None
    r = nombre(s) if numerique else None
    if r is None:
        return s
    return int(r[0]) if r[0] == r[0].to_integral_value() else float(r[0])


def _lot_modifiable(db: Session, lot_id: int) -> LotImport:
    """Lot verrouillé, encore corrigeable et dont le fichier a été gardé."""
    lot = _get_lot(db, lot_id, verrou=True)
    if lot.statut not in ("pret", "rejete"):
        raise HTTPException(409, f"Lot au statut « {lot.statut} » : modification impossible")
    if not lot.feuille:
        raise HTTPException(409, "Fichier analysé avant les corrections sur place : "
                                 "le corriger dans Excel puis l'importer de nouveau.")
    if db.scalar(select(ImportAnomalie.id).where(ImportAnomalie.lot_id == lot.id,
                                                 ImportAnomalie.code.in_(CODES_FORMULE)).limit(1)):
        raise HTTPException(409, "Formules sans valeur utilisable : corriger le fichier dans Excel "
                                 "puis l'importer de nouveau.")
    return lot


def _feuille_du_lot(lot: LotImport) -> Feuille:
    f = lot.feuille
    formules: dict[int, dict[int, str]] = {}
    for n, j, t in f.get("formules", []):
        formules.setdefault(n, {})[j] = t
    return Feuille(f["entete_ligne"], f["entetes"], [(n, tuple(r)) for n, r in f["lignes"]],
                   f["ligne_ignoree"], formules)


# Rapport annoté : à corriger, à confirmer.
ROUGE, ORANGE = "FFC7CE", "FFE4B5"

DIM_REFS = {"service": "services", "activite": "activites", "site": "sites", "type_contrat": "contrats",
            "poste": "postes"}


def _refs_du_lot(db: Session, lot: LotImport, ajouts: dict | None = None) -> Refs:
    """Référentiels de la base, plus les valeurs que le lot propose d'ajouter (créées à la validation)."""
    refs = charger_refs(db)
    for dim, valeurs in (lot.feuille.get("ajouts", {}) if ajouts is None else ajouts).items():
        idx = getattr(refs, DIM_REFS[dim])
        for v in valeurs:
            if isinstance(idx, set):  # postes : textes normalisés seulement
                idx.add(norm(v))
            else:
                idx[norm(v)] = v
    return refs


def _relancer(db: Session, lot: LotImport, feuille: Feuille, refs: Refs, **decisions) -> None:
    """Relance tous les contrôles ; les décisions du lot (ajouts, lignes retirées) sont conservées."""
    lignes, anos, stats = _controler(feuille, refs, decisions.get("ignores", lot.feuille.get("ignores", [])))
    if lot.statut == "rejete" and _statut(anos) == "pret" and db.scalar(select(LotImport.id).where(
            LotImport.sha256 == lot.sha256, LotImport.id != lot.id,
            LotImport.statut.in_(("pret", "valide")))) is not None:
        raise HTTPException(409, "Ce fichier est déjà en vérification ou importé : reprendre ce lot-là.")
    gardees = {k: lot.feuille[k] for k in ("ajouts", "retirees", "ignores") if k in lot.feuille}
    lot.feuille = {**_feuille_json(feuille), **gardees, **decisions}
    _ecrire(db, lot, lignes, anos, stats)


CODES_AUTO = ("NORMALISE", "TEXTE_CONVERTI")  # valeurs corrigées d'office, refusables


def _controler(feuille: Feuille, refs: Refs, ignores):
    """Contrôles du lot ; un avertissement sur une cellule que l'utilisateur a choisi d'ignorer n'est plus signalé.
    « !ligne|colonne » : correction automatique refusée, la cellule passe en erreur à corriger."""
    lignes, anos, stats = valider(feuille, refs)
    ign = set(ignores)
    out = []
    for a in anos:
        c = f"{a.ligne}|{a.colonne}"
        if a.gravite != BLOQUANT and a.code in CODES_AUTO and f"!{c}" in ign:
            a = replace(a, code="CORRECTION_REFUSEE", gravite=BLOQUANT,
                        message=f"Correction automatique refusée ({a.message}) : saisir la bonne valeur.")
        elif a.gravite != BLOQUANT and c in ign:
            continue
        out.append(a)
    return lignes, out, stats


def appliquer_decisions(db: Session, user_id: int, lot_id: int, corrections: dict[int, dict[str, str | None]],
                        ajouts: list[dict], retirees: list[int], ignores: list[str], simuler: bool):
    """Toutes les décisions de l'écran en une fois : valeurs ajoutées aux listes, lignes retirées, cellules
    corrigées, cellules ignorées. Simulation : renvoie les points restants sans rien écrire."""
    lot = _lot_modifiable(db, lot_id)
    feuille = _feuille_du_lot(lot)
    tout = {d: dict(v) for d, v in lot.feuille.get("ajouts", {}).items()}
    refs = _refs_du_lot(db, lot)
    for a in ajouts:
        dim, valeur, type_site = a["dimension"], (a.get("valeur") or "").strip(), a.get("type_site")
        if dim not in DIM_REFS:
            raise HTTPException(422, "Liste inconnue")
        if not valeur or len(valeur) > 200:
            raise HTTPException(422, "Valeur attendue (200 caractères au plus)")
        if norm(valeur) in getattr(refs, DIM_REFS[dim]):
            raise HTTPException(409, f"« {valeur} » est déjà dans la liste")
        if dim != "site":
            type_site = None
        elif type_site not in TYPES_SITE and not simuler:
            raise HTTPException(422, "Type de site obligatoire : " + ", ".join(TYPES_SITE))
        tout.setdefault(dim, {})[valeur] = type_site
    refs = _refs_du_lot(db, lot, tout)
    cols = colonnes(feuille.entetes, refs)
    texte_libre = set(ATTRIBUTS) - {"ANNÉE"}
    presents = {n for n, _ in feuille.lignes}
    traces = []
    for num, valeurs in corrections.items():
        if num not in presents:
            raise HTTPException(404, f"Ligne {num} introuvable")
        k = next(k for k, (n, _) in enumerate(feuille.lignes) if n == num)
        row, avant = list(feuille.lignes[k][1]), {}
        s0, b0 = _somme_composantes(row, cols), _montant(row, cols, BRUT)
        brut_juste = s0 is not None and b0 is not None and abs(b0 - s0) < 1
        for col, v in valeurs.items():
            j = cols.get(col)
            if j is None:
                raise HTTPException(422, f"Colonne « {col} » absente du fichier")
            row += [None] * (j + 1 - len(row))
            avant[col] = _brut(row[j])
            row[j] = _saisie(v, col not in texte_libre)
        if brut_juste and BRUT not in valeurs and set(valeurs) & set(COMPOSANTES_BRUT) and (
                s := _somme_composantes(row, cols)) is not None:
            # Brut Réel juste avant la correction d'une composante : il suit, sinon un nouvel écart apparaîtrait.
            avant[BRUT] = _brut(row[cols[BRUT]])
            row[cols[BRUT]] = _saisie(format(s.normalize(), "f"), True)
            valeurs = {**valeurs, BRUT: format(s.normalize(), "f")}
        feuille.lignes[k] = (num, tuple(row))
        traces.append(("import_correction", {"ligne": num, **avant}, {"ligne": num, **valeurs}))
    for num in retirees:
        if num not in presents:
            raise HTTPException(404, f"Ligne {num} introuvable")
        traces.append(("import_ligne_retiree", {"ligne": num}, None))
    feuille.lignes = [(n, r) for n, r in feuille.lignes if n not in set(retirees)]
    # Une cellule corrigée à la main perd ses décisions passées (correction refusée, avertissement accepté) :
    # un nouveau problème sur la valeur saisie doit se voir.
    saisies = {f"{p}{n}|{c}" for n, v in corrections.items() for c in v for p in ("", "!")}
    tous_ignores = sorted(set(lot.feuille.get("ignores", [])) - saisies | set(ignores))
    if simuler:
        _, anos, _ = _controler(feuille, refs, tous_ignores)
        db.rollback()
        return [{"ligne": a.ligne, "colonne": a.colonne, "code": a.code} for a in anos]
    _relancer(db, lot, feuille, refs, ajouts=tout, retirees=[*lot.feuille.get("retirees", []), *retirees],
              ignores=tous_ignores)
    for a in ajouts:
        traces.append(("import_ajout_referentiel", None, a))
    if ignores:
        traces.append(("import_ignore", None, {"cellules": ignores}))
    for action, avant, apres in traces:
        audit.record(db, user_id, action, "lot_import", lot.id, avant, apres)
    db.commit()
    return lot


def corriger_ligne(db: Session, user_id: int, lot_id: int, num: int,
                   valeurs: dict[str, str | None]) -> LotImport:
    """Corrige des cellules d'une ligne du fichier puis relance tous les contrôles (doublons,
    noms proches… dépendent des autres lignes). Rien n'est écrit hors du lot."""
    lot = _lot_modifiable(db, lot_id)
    feuille = _feuille_du_lot(lot)
    k = next((k for k, (n, _) in enumerate(feuille.lignes) if n == num), None)
    if k is None:
        raise HTTPException(404, "Ligne introuvable")
    refs = _refs_du_lot(db, lot)
    cols = colonnes(feuille.entetes, refs)
    texte_libre = set(ATTRIBUTS) - {"ANNÉE"}
    row, avant = list(feuille.lignes[k][1]), {}
    for col, v in valeurs.items():
        j = cols.get(col)
        if j is None:
            raise HTTPException(422, f"Colonne « {col} » absente du fichier")
        row += [None] * (j + 1 - len(row))
        avant[col] = row[j]
        row[j] = _saisie(v, col not in texte_libre)
    feuille.lignes[k] = (num, tuple(row))
    _relancer(db, lot, feuille, refs)
    audit.record(db, user_id, "import_correction", "lot_import", lot.id,
                 {"ligne": num, **avant}, {"ligne": num, **valeurs})
    db.commit()
    return lot


def ajouter_referentiel(db: Session, user_id: int, lot_id: int, dimension: str, valeur: str,
                        type_site: str | None = None) -> LotImport:
    """Décide d'ajouter une valeur inconnue au référentiel : gardée dans le lot, créée à la validation."""
    if dimension not in DIM_REFS:
        raise HTTPException(422, "Liste inconnue")
    valeur = (valeur or "").strip()
    if not valeur or len(valeur) > 200:
        raise HTTPException(422, "Valeur attendue (200 caractères au plus)")
    if dimension == "site":
        if type_site not in TYPES_SITE:
            raise HTTPException(422, "Type de site obligatoire : " + ", ".join(TYPES_SITE))
    else:
        type_site = None
    lot = _lot_modifiable(db, lot_id)
    refs = _refs_du_lot(db, lot)
    if norm(valeur) in getattr(refs, DIM_REFS[dimension]):
        raise HTTPException(409, f"« {valeur} » est déjà dans la liste")
    ajouts = {d: dict(v) for d, v in lot.feuille.get("ajouts", {}).items()}
    ajouts.setdefault(dimension, {})[valeur] = type_site
    _relancer(db, lot, _feuille_du_lot(lot), _refs_du_lot(db, lot, ajouts), ajouts=ajouts)
    audit.record(db, user_id, "import_ajout_referentiel", "lot_import", lot.id, None,
                 {"dimension": dimension, "valeur": valeur, "type_site": type_site})
    db.commit()
    return lot


def retirer_ligne(db: Session, user_id: int, lot_id: int, num: int) -> LotImport:
    """Retire une ligne du lot (doublon…) ; le fichier d'origine n'est pas touché."""
    lot = _lot_modifiable(db, lot_id)
    feuille = _feuille_du_lot(lot)
    ligne = next((r for n, r in feuille.lignes if n == num), None)
    if ligne is None:
        raise HTTPException(404, "Ligne introuvable")
    feuille.lignes = [(n, r) for n, r in feuille.lignes if n != num]
    refs = _refs_du_lot(db, lot)
    avant = {"ligne": num, **{c: _brut(ligne[j]) if j < len(ligne) else None
                              for c, j in colonnes(feuille.entetes, refs).items()}}
    _relancer(db, lot, feuille, refs, retirees=[*lot.feuille.get("retirees", []), num])
    audit.record(db, user_id, "import_ligne_retiree", "lot_import", lot.id, avant, None)
    db.commit()
    return lot


def _montant(row, cols, col) -> Decimal | None:
    j = cols.get(col)
    if j is None or j >= len(row):
        return None
    r = nombre(row[j])
    return r[0] if r else None


def _somme_composantes(row, cols) -> Decimal | None:
    """Somme des composantes du Brut Réel ; None si une cellule remplie n'est pas un nombre."""
    if BRUT not in cols or any(c not in cols for c in COMPOSANTES_BRUT):
        return None
    total = Decimal(0)
    for c in COMPOSANTES_BRUT:
        j = cols[c]
        if j < len(row) and texte(row[j]):
            if (m := _montant(row, cols, c)) is None:
                return None
            total += m
    return total


def _brut(x) -> str | None:
    """Valeur du fichier telle qu'on la retape : 1000.0 s'écrit 1000."""
    if isinstance(x, float) and x.is_integer():
        x = int(x)
    return None if x is None else str(x)


def annoter_feuille(db: Session, lot: LotImport, anos, ws) -> None:
    """Recopie la feuille importée dans `ws`, aux mêmes lignes ; cellule en cause en rouge (à corriger)
    ou orange (à confirmer), message en commentaire ; point sans colonne : toute la ligne."""
    if not lot.feuille:
        return
    f = lot.feuille
    for j, v in enumerate(f["entetes"], 1):
        ws.cell(f["entete_ligne"], j, v).font = Font(bold=True)
    largeur = len(f["entetes"])
    for n, row in f["lignes"]:
        for j, v in enumerate(row, 1):
            ws.cell(n, j, v)
        largeur = max(largeur, len(row))
    cols = colonnes(f["entetes"], _refs_du_lot(db, lot))
    points: dict[tuple[int, int | None], list] = {}
    for a in anos:
        if a.num_ligne is not None:
            j = cols.get(a.colonne) if a.colonne else None
            points.setdefault((a.num_ligne, None if j is None else j + 1), []).append(a)
    for (n, j), liste in points.items():
        couleur = ROUGE if any(a.gravite == BLOQUANT for a in liste) else ORANGE
        remplissage = PatternFill("solid", fgColor=couleur)
        for c in [j] if j else range(1, largeur + 1):
            ws.cell(n, c).fill = remplissage
        ws.cell(n, j or 1).comment = Comment("\n".join(a.message for a in liste)[:30000], "Contrôle")
    ws.freeze_panes = ws.cell(f["entete_ligne"] + 1, 1)


def ligne_du_lot(db: Session, lot_id: int, num: int) -> dict:
    """Ligne lue (valeurs comprises par les contrôles), avec, si le lot garde le fichier, les valeurs
    brutes à corriger et les listes de valeurs proposées (sans obligation : on peut taper autre chose)."""
    row = db.scalar(select(StagingLigne).where(StagingLigne.lot_id == lot_id, StagingLigne.num_ligne == num))
    lot = _get_lot(db, lot_id)
    brut = choix = None
    if lot.feuille:
        cells = next((r for n, r in lot.feuille["lignes"] if n == num), None)
        if cells is not None:
            refs = _refs_du_lot(db, lot)
            brut = {c: _brut(cells[j]) if j < len(cells) else None
                    for c, j in colonnes(lot.feuille["entetes"], refs).items()}
            choix = {c: sorted(set(d.values()), key=norm) for c, d in (
                ("Type Contrat", refs.contrats), ("Activité", refs.activites),
                ("Site", refs.sites), ("Service", refs.services))}
    if row is None and brut is None:
        raise HTTPException(404, "Ligne introuvable")
    lu = ({"annee": row.annee, "mois": row.mois, "matricule": row.matricule, **row.donnees} if row else
          {"annee": None, "mois": None, "matricule": None, "nom": None, "poste": None, "type_contrat": None,
           "activite": None, "site": None, "service": None, "montants": {}})
    return {"ligne": num, **lu, "brut": brut, "choix": choix}


COLONNES_REF = {"Type Contrat": ("type_contrat", TypeContrat, "type_contrat_id"),
                "Activité": ("activite", Activite, "activite_id"),
                "Site": ("site", Site, "site_id"), "Service": ("service", Service, "service_id")}


PRECEDENT = {c: (m, f) for c, (_d, m, f) in COLONNES_REF.items()} | {"Poste": (Poste, "poste_id")}


def _periode_du_fichier(db: Session, lot_id: int, col: str) -> list[dict]:
    """ANNÉE ou MOIS vide : valeurs des autres lignes du lot, la plus fréquente d'abord."""
    champ = StagingLigne.annee if col == "ANNÉE" else StagingLigne.mois
    vus = db.execute(select(champ, func.count()).where(StagingLigne.lot_id == lot_id, champ.is_not(None))
                     .group_by(champ).order_by(func.count().desc(), champ)).all()
    texte = (lambda v: str(v)) if col == "ANNÉE" else (lambda v: MOIS[v - 1])
    if len(vus) == 1:
        return [{"valeur": texte(vus[0][0]), "libelle": f"{texte(vus[0][0])}, comme les autres lignes du fichier"}]
    return [{"valeur": texte(v), "libelle": f"{texte(v)} ({n} ligne{'s' if n > 1 else ''} du fichier)"}
            for v, n in vus]


def _valeur_avant_dans_lot(db: Session, lot_id: int, r: StagingLigne, cle: str) -> dict | None:
    """Valeur de la même colonne pour le même employé, au dernier mois du lot avant celui de la ligne."""
    q = (select(StagingLigne).where(
        StagingLigne.lot_id == lot_id, func.lower(StagingLigne.matricule) == r.matricule.casefold(),
        (StagingLigne.annee < r.annee) | ((StagingLigne.annee == r.annee) & (StagingLigne.mois < r.mois)))
        .order_by(StagingLigne.annee.desc(), StagingLigne.mois.desc(), StagingLigne.num_ligne.desc()))
    for p in db.scalars(q):
        if (p.donnees or {}).get(cle):
            return {"valeur": p.donnees[cle], "periode": f"{MOIS[p.mois - 1].lower()} {p.annee}"}
    return None


def propositions(db: Session, lot_id: int, anos) -> dict[int, dict]:
    """Aide à la décision pour chaque point : lignes du doublon, valeur du mois précédent,
    liste où ajouter une valeur inconnue, lectures d'un nombre ambigu, période des autres lignes,
    ligne de total à supprimer. Clé : id du point."""
    ref = ("VALEUR_MANQUANTE", "REFERENTIEL_INCONNU")
    nums = {a.num_ligne for a in anos if a.num_ligne and (
        a.code in ("DOUBLON", "MUTATION", "BRUT_REEL_ECART", "PERIODE_ISOLEE", *FACTEURS, *CODES_NOMS)
        or (a.code in ref and (a.colonne in PRECEDENT or a.colonne == "Noms")))}
    annuaire: dict[str, tuple[str, str]] | None = None
    rows = {r.num_ligne: r for r in db.scalars(select(StagingLigne).where(
        StagingLigne.lot_id == lot_id, StagingLigne.num_ligne.in_(nums)))} if nums else {}
    periodes: dict[str, list[dict]] = {}
    nouvelles: tuple | None = None
    out: dict[int, dict] = {}
    for a in anos:
        prop: dict = {}
        if a.code == "SEPARATEUR_AMBIGU":
            # « 45.000 » : les deux lectures possibles, proposées comme correction.
            prop["corrections"] = [{"valeur": str(d), "libelle": lib} for d, lib in interpretations(a.valeur)]
        if a.colonne in ("ANNÉE", "MOIS") and a.code in ("ANNEE_INVALIDE", "VALEUR_MANQUANTE") and not a.valeur:
            if a.colonne not in periodes:
                periodes[a.colonne] = _periode_du_fichier(db, lot_id, a.colonne)
            if periodes[a.colonne]:
                prop["corrections"] = periodes[a.colonne]
        if a.code == "LIGNE_TOTAL":
            prop["lignes"] = [a.num_ligne]
        if a.code == "PERIODE_ISOLEE":
            if a.colonne not in periodes:
                periodes[a.colonne] = _periode_du_fichier(db, lot_id, a.colonne)
            # Période où l'employé a déjà sa ligne : la proposer créerait un doublon.
            r_iso = rows.get(a.num_ligne)
            prises = {MOIS[o.mois - 1] if a.colonne == "MOIS" else str(o.annee) for o in db.scalars(select(StagingLigne).where(
                StagingLigne.lot_id == lot_id, StagingLigne.num_ligne != a.num_ligne,
                func.lower(StagingLigne.matricule) == r_iso.matricule.casefold(),
                (StagingLigne.annee == r_iso.annee) if a.colonne == "MOIS" else (StagingLigne.mois == r_iso.mois)))
                if o.annee is not None and o.mois is not None} if r_iso is not None and r_iso.matricule else set()
            if v := next((p["valeur"] for p in periodes[a.colonne] if p["valeur"] not in prises), None):
                prop["corrections"] = [{"valeur": v, "libelle": f"Corriger en {v}, comme les autres lignes"}]
        r_g12 = rows.get(a.num_ligne)
        if r_g12 is not None and a.colonne and (a.code in FACTEURS or a.code == "BRUT_REEL_ECART"):
            m = {k: Decimal(x) for k, x in (r_g12.donnees.get("montants") or {}).items()}
            juste = somme_brut(m) if a.code == "BRUT_REEL_ECART" else (
                m[a.colonne] * FACTEURS[a.code] if a.colonne in m else None)
            if a.colonne == BRUT and a.code in FACTEURS and BRUT in m and abs(m[BRUT] - somme_brut(m)) < 1:
                # Brut Réel juste mais composante aussi signalée : la bonne valeur est la somme corrigée.
                f = {b.colonne: FACTEURS[b.code] for b in anos if b.num_ligne == a.num_ligne and b.code in FACTEURS}
                juste = somme_brut({k: v * f.get(k, 1) for k, v in m.items()})
            if juste is not None:
                prop["corrections"] = [{"valeur": format(juste.normalize(), "f"), "libelle": f"Corriger en {fr(juste)}"}]
        if a.code in NOUVELLES and a.valeur:
            if nouvelles is None:
                nouvelles = _nouvelles_valeurs(db, lot_id)
            prop |= _proposition_nouvelle(nouvelles, a.colonne, a.valeur)
        r = rows.get(a.num_ligne)
        if r is not None and r.annee is not None and r.mois is not None and r.matricule:
            if a.code in CODES_NOMS:
                if annuaire is None and a.code in ("NOM_SIMILAIRE", "MATRICULE_DOUTEUX"):
                    annuaire = {s.matricule_norm: (s.matricule, s.nom) for s in db.scalars(select(Salarie)) if s.nom}
                prop |= _proposition_nom(db, lot_id, r, a.code, annuaire or {})
            elif a.code == "DOUBLON":
                q = select(StagingLigne.num_ligne).where(
                    StagingLigne.lot_id == lot_id, StagingLigne.annee == r.annee,
                    StagingLigne.mois == r.mois, func.lower(StagingLigne.matricule) == r.matricule.casefold())
                prop["lignes"] = sorted(db.scalars(q))
            elif a.code == "VALEUR_MANQUANTE" and a.colonne == "Noms":
                # Nom vide d'un matricule connu : le nom enregistré est la correction quasi sûre.
                nom = db.scalar(select(Salarie.nom).where(Salarie.matricule_norm == r.matricule.casefold()))
                if nom:
                    prop["corrections"] = [{"valeur": nom, "libelle": f"Reprendre le nom enregistré ({nom})"}]
            elif a.code == "MUTATION" and a.colonne in COLONNES_REF and (
                    avant := _valeur_avant_dans_lot(db, lot_id, r, COLONNES_REF[a.colonne][0])):
                # Changement entre deux mois du fichier : la valeur du mois d'avant, candidate si c'est une erreur.
                prop |= avant
            elif (a.code in ref or a.code == "MUTATION") and a.colonne in PRECEDENT and len(prop.get("lignes", [])) < 2:
                # Valeur du dernier mois enregistré avant celui de la ligne : candidate au remplacement.
                model, attr = PRECEDENT[a.colonne]
                q = (select(model.libelle, Periode.annee, Periode.mois)
                     .select_from(SituationMensuelle)
                     .join(Periode, Periode.id == SituationMensuelle.periode_id)
                     .join(Salarie, Salarie.id == SituationMensuelle.salarie_id)
                     .join(model, model.id == getattr(SituationMensuelle, attr))
                     .where(Salarie.matricule_norm == r.matricule.casefold(),
                            (Periode.annee < r.annee) | ((Periode.annee == r.annee) & (Periode.mois < r.mois)))
                     .order_by(Periode.annee.desc(), Periode.mois.desc()).limit(1))
                trouve = db.execute(q).first()
                if trouve:
                    prop |= {"valeur": trouve[0], "periode": f"{MOIS[trouve[2] - 1].lower()} {trouve[1]}"}
        if prop:
            out[a.id] = prop
    return out


CODES_NOMS = ("NOM_PROCHE", "NOM_INCOHERENT", "NOM_SIMILAIRE", "MATRICULE_DOUTEUX")
NOUVELLES = ("REFERENTIEL_INCONNU", "POSTE_NOUVEAU")
SEUIL_VALEUR_PROCHE = 0.75  # valeur existante proposée en remplacement d'une valeur inconnue


def _nouvelles_valeurs(db: Session, lot_id: int) -> tuple:
    """Lignes brutes du lot, position des colonnes et valeurs existantes de chaque liste (ajouts du lot compris)."""
    lot = _get_lot(db, lot_id)
    if not lot.feuille:
        return [], {}, {}
    refs = _refs_du_lot(db, lot)
    existantes = {c: sorted(set(getattr(refs, DIM_REFS[d]).values()), key=norm)
                  for c, (d, _m, _f) in COLONNES_REF.items()}
    existantes["Poste"] = sorted(set(_ids(db, Poste)) | set((lot.feuille.get("ajouts") or {}).get("poste", {})), key=norm)
    return lot.feuille["lignes"], colonnes(lot.feuille["entetes"], refs), existantes


def _proposition_nouvelle(nouvelles: tuple, col: str | None, valeur: str) -> dict:
    """Valeur absente d'une liste : liste où l'ajouter, toutes ses lignes (la décision vaut pour toutes) et la
    valeur existante la plus ressemblante, à proposer en remplacement."""
    rows, cols, existantes = nouvelles
    prop: dict = {"dimension": "poste" if col == "Poste" else COLONNES_REF[col][0]} if col in PRECEDENT else {}
    j = cols.get(col)
    if j is not None:
        prop["lignes"] = [n for n, r in rows if j < len(r) and r[j] is not None and norm(str(r[j])) == norm(valeur)]
    scores = [(similarite(valeur, v), v) for v in existantes.get(col, [])]
    meilleur = max(scores, default=(0, None))
    if meilleur[0] >= SEUIL_VALEUR_PROCHE:
        prop["proche"] = meilleur[1]
    return prop



def _proposition_nom(db: Session, lot_id: int, r: StagingLigne, code: str,
                     annuaire: dict[str, tuple[str, str]]) -> dict:
    """Lignes de l'employé dans le lot (la décision vaut pour toutes) et, selon le point : noms lus et nom
    enregistré, ou employé connu que désigne sans doute la ligne."""
    lignes = db.execute(select(StagingLigne.num_ligne, StagingLigne.donnees).where(
        StagingLigne.lot_id == lot_id, func.lower(StagingLigne.matricule) == r.matricule.casefold())
        .order_by(StagingLigne.num_ligne)).all()
    prop: dict = {"lignes": [n for n, _ in lignes]}
    if code in ("NOM_PROCHE", "NOM_INCOHERENT"):
        enregistre = db.scalar(select(Salarie.nom).where(Salarie.matricule_norm == r.matricule.casefold()))
        noms = dict.fromkeys(d["nom"] for _, d in lignes if d.get("nom") and norm(d["nom"]) != norm(enregistre or ""))
        return prop | {"noms": list(noms), "enregistre": enregistre or None}
    nom = r.donnees.get("nom") or ""
    trouve = (employe_probable(r.matricule, nom, annuaire) if code == "MATRICULE_DOUTEUX"
              else plus_proche(nom, annuaire, r.matricule.casefold(), SEUIL_NOUVEAU_PROCHE))
    return prop | {"employe": {"matricule": trouve[0], "nom": trouve[1]}} if trouve else prop


def employes_des_lignes(db: Session, lot_id: int, nums: set[int]) -> dict[int, dict]:
    """Matricule et nom de l'employé de chaque ligne : nom du fichier, sinon celui déjà enregistré."""
    if not nums:
        return {}
    rows = db.execute(select(StagingLigne.num_ligne, StagingLigne.matricule, StagingLigne.donnees)
                      .where(StagingLigne.lot_id == lot_id, StagingLigne.num_ligne.in_(nums))).all()
    mats = {r.matricule.casefold() for r in rows if r.matricule}
    connus = dict(db.execute(select(Salarie.matricule_norm, Salarie.nom)
                             .where(Salarie.matricule_norm.in_(mats))).all()) if mats else {}
    return {r.num_ligne: {
        "matricule": None if est_sans_matricule(r.matricule) else r.matricule,
        "nom": (r.donnees or {}).get("nom") or connus.get((r.matricule or "").casefold()),
    } for r in rows}


def _get_lot(db: Session, lot_id: int, *, verrou: bool = False) -> LotImport:
    q = select(LotImport).where(LotImport.id == lot_id)
    lot = db.scalar(q.with_for_update() if verrou else q)
    if lot is None:
        raise HTTPException(404, "Lot introuvable")
    return lot


def _snapshot(db: Session, sit: SituationMensuelle) -> dict:
    montants = db.execute(select(Montant.rubrique_id, Montant.valeur)
                          .where(Montant.situation_id == sit.id)).all()
    return {
        "service_id": sit.service_id, "site_id": sit.site_id, "activite_id": sit.activite_id,
        "type_contrat_id": sit.type_contrat_id, "poste_id": sit.poste_id,
        "lot_import_id": sit.lot_import_id,
        "montants": {str(r): str(v) for r, v in montants},
    }


def _ids(db: Session, model) -> dict[str, int]:
    return {r.libelle: r.id for r in db.scalars(select(model))}


Cle = tuple[int, int, str]  # (année, mois, matricule casefold)


def _cle(r: StagingLigne) -> Cle:
    return (r.annee, r.mois, r.matricule.casefold())


def _situations_existantes(db: Session, rows: list[StagingLigne]) -> dict[Cle, SituationMensuelle]:
    """Situations déjà en base pour les clés (période, salarié) du lot."""
    cles = {_cle(r) for r in rows}
    if not cles:
        return {}
    q = (select(Periode.annee, Periode.mois, Salarie.matricule_norm, SituationMensuelle)
         .join(Periode, Periode.id == SituationMensuelle.periode_id)
         .join(Salarie, Salarie.id == SituationMensuelle.salarie_id)
         .where(Periode.annee.in_({c[0] for c in cles}), Periode.mois.in_({c[1] for c in cles}),
                Salarie.matricule_norm.in_({c[2] for c in cles})))
    return {(a, m, k): s for a, m, k, s in db.execute(q) if (a, m, k) in cles}


ATTRS_APERCU = (("poste", "Poste", Poste, "poste_id"), ("type_contrat", "Type Contrat", TypeContrat,
                "type_contrat_id"), ("activite", "Activité", Activite, "activite_id"),
                ("site", "Site", Site, "site_id"), ("service", "Service", Service, "service_id"))


def apercu(db: Session, lot_id: int) -> dict:
    """Différences entre le lot et la base, sans écriture : ce que la validation changerait."""
    from app.kpi.chargement import exclues_a_date
    from app.kpi.moteur import total_ligne

    lot = _get_lot(db, lot_id)
    rows = list(db.scalars(select(StagingLigne).where(StagingLigne.lot_id == lot.id)
                           .order_by(StagingLigne.num_ligne)))
    # Ligne sans mois lisible (ligne « TOTAL » en bas du fichier…) : déjà bloquante, rien à comparer.
    rows = [r for r in rows if r.annee and r.mois]
    existantes = _situations_existantes(db, rows)
    rub = {r.id: r.libelle for r in db.scalars(select(Rubrique))}
    lib = {a: {r.id: r.libelle for r in db.scalars(select(m))} for a, _c, m, _f in ATTRS_APERCU}
    connus = set(db.scalars(select(Salarie.matricule_norm)))
    exclues = {p: exclues_a_date(db, *p) for p in {(r.annee, r.mois) for r in rows}}
    lignes, compte = [], {"nouvelle": 0, "modifiee": 0, "identique": 0}
    for r in rows:
        k = _cle(r)
        apres = {n: Decimal(v) for n, v in r.donnees["montants"].items()}
        ligne = {"annee": r.annee, "mois": r.mois, "matricule": r.matricule,
                 "nom": r.donnees.get("nom"), "nouveau_salarie": k[2] not in connus,
                 "total_apres": str(total_ligne(apres, exclues[k[:2]]))}
        sit = existantes.get(k)
        if sit is None:
            ligne |= {"statut": "nouvelle", "total_avant": None, "changements": []}
        else:
            avant = {rub[rid]: v for rid, v in db.execute(
                select(Montant.rubrique_id, Montant.valeur).where(Montant.situation_id == sit.id))}
            chg = [{"colonne": col, "avant": lib[a].get(getattr(sit, f)), "apres": r.donnees.get(a)}
                   for a, col, _m, f in ATTRS_APERCU
                   if norm(lib[a].get(getattr(sit, f)) or "") != norm(r.donnees.get(a) or "")]
            chg += [{"colonne": n, "avant": None if n not in avant else str(avant[n]),
                     "apres": None if n not in apres else str(apres[n])}
                    for n in [x for x in rub.values() if x in avant or x in apres]
                    if avant.get(n) != apres.get(n)]
            ligne |= {"statut": "modifiee" if chg else "identique",
                      "total_avant": str(total_ligne(avant, exclues[k[:2]])), "changements": chg}
        compte[ligne["statut"]] += 1
        lignes.append(ligne)
    nouveaux = {x["matricule"] for x in lignes if x["nouveau_salarie"]}
    tous = {x["matricule"] for x in lignes}
    absents = _absents_du_lot(db, {_cle(r) for r in rows}, {(r.annee, r.mois) for r in rows})
    return {"lot": lot_dict(lot), **compte,
            "effaces": sum(1 for x in lignes for c in x["changements"]
                           if c["apres"] is None and c["avant"] is not None),
            "nouveaux_salaries": sorted(nouveaux),
            "employes": {"total": len(tous), "nouveaux": len(nouveaux), "existants": len(tous - nouveaux)},
            "total_lot": str(sum((Decimal(x["total_apres"]) for x in lignes), Decimal(0))),
            "absents": absents[:100], "nb_absents": len(absents),
            "lignes": lignes}


def _absents_du_lot(db: Session, presents: set[Cle], periodes: set[tuple[int, int]]) -> list[dict]:
    """Employés présents le mois précédent, ni dans le lot ni déjà en base pour le mois (départ, oubli ?)."""
    sortie = []
    for a, m in sorted(periodes):
        pa, pm = (a, m - 1) if m > 1 else (a - 1, 12)
        deja_saisis = (select(SituationMensuelle.salarie_id)
                       .join(Periode, Periode.id == SituationMensuelle.periode_id)
                       .where(Periode.annee == a, Periode.mois == m))
        q = (select(Salarie.matricule, Salarie.matricule_norm, Salarie.nom)
             .join(SituationMensuelle, SituationMensuelle.salarie_id == Salarie.id)
             .join(Periode, Periode.id == SituationMensuelle.periode_id)
             .where(Periode.annee == pa, Periode.mois == pm, Salarie.id.not_in(deja_saisis))
             .order_by(Salarie.nom))
        sortie += [{"annee": a, "mois": m, "matricule": mat, "nom": nom}
                   for mat, mn, nom in db.execute(q) if (a, m, mn) not in presents]
    return sortie


def valider_lot(db: Session, user_id: int, lot_id: int, garder: set[Cle] | None = None) -> LotImport:
    """Valide le lot. `garder` : clés dont la ligne déjà en base est conservée (ligne du lot ignorée)."""
    lot = _get_lot(db, lot_id, verrou=True)
    if lot.statut != "pret":
        raise HTTPException(409, f"Lot au statut « {lot.statut} » : validation impossible")
    if db.scalar(select(LotImport.id).where(LotImport.sha256 == lot.sha256,
                                            LotImport.statut == "valide")):
        raise HTTPException(409, "Fichier déjà importé")
    rows = list(db.scalars(select(StagingLigne).where(StagingLigne.lot_id == lot.id)))
    if not rows:
        raise HTTPException(409, "Lot vide")
    ignorees = 0
    if garder:
        # les lignes ignorées sortent du staging : l'annulation compare toujours au staging restant
        gardees = set(_situations_existantes(db, rows)) & {(a, m, k.casefold()) for a, m, k in garder}
        ignorer = [r for r in rows if _cle(r) in gardees]
        if ignorer:
            db.execute(delete(StagingLigne).where(StagingLigne.id.in_([r.id for r in ignorer])))
            rows = [r for r in rows if _cle(r) not in gardees]
            ignorees = len(ignorer)
            lot.stats = {**(lot.stats or {}), "ignorees": ignorees}
    if not rows:
        lot.statut, lot.valide_par, lot.valide_le = "valide", user_id, _now()
        audit.record(db, user_id, "import_valide", "lot_import", lot.id, None,
                     {"situations": 0, "montants": 0, "remplacees": 0, "ignorees": ignorees})
        db.commit()
        return lot

    cles_periodes = {(r.annee, r.mois) for r in rows}
    periodes = {(p.annee, p.mois): p.id for p in db.scalars(select(Periode))}
    for a, m in sorted(cles_periodes - set(periodes)):
        p = Periode(annee=a, mois=m)
        db.add(p)
        db.flush()
        periodes[(a, m)] = p.id

    salaries = {s.matricule_norm: s.id for s in db.scalars(select(Salarie))}
    nouveaux = set()
    for r in rows:
        k = r.matricule.casefold()
        if k not in salaries:
            s = Salarie(matricule=r.matricule, matricule_norm=k, nom=r.donnees.get("nom") or "")
            db.add(s)
            db.flush()
            salaries[k] = s.id
            nouveaux.add(k)
    # « Mettre à jour le nom » (point de nom accepté) : le nom du fichier remplace le nom enregistré.
    ignores = set((lot.feuille or {}).get("ignores", []))
    for r in rows:
        k, nom = r.matricule.casefold(), r.donnees.get("nom")
        if nom and k not in nouveaux and f"{r.num_ligne}|Noms" in ignores:
            s = db.get(Salarie, salaries[k])
            if s.nom != nom:
                audit.record(db, user_id, "salarie_renomme", "salarie", s.id, {"nom": s.nom}, {"nom": nom})
                s.nom = nom

    postes = {norm(k): v for k, v in _ids(db, Poste).items()}
    for r in rows:
        p = r.donnees.get("poste")
        if p and norm(p) not in postes:
            obj = Poste(libelle=p)
            db.add(obj)
            db.flush()
            postes[norm(p)] = obj.id

    # valeurs de référentiel ajoutées dans le lot : créées maintenant seulement
    for dim, valeurs in ((lot.feuille or {}).get("ajouts") or {}).items():
        model = DIM_MODELS[dim]
        connus = {norm(k) for k in _ids(db, model)}
        for v, type_site in valeurs.items():
            if norm(v) not in connus:
                db.add(Site(libelle=v, type_site=type_site) if dim == "site" else model(libelle=v))
        db.flush()

    ids = {d: _ids(db, m) for d, m in DIM_MODELS.items() if d != "poste"}
    rub = _ids(db, Rubrique)

    # fiche employé des nouveaux salariés : attributs de leur première ligne
    for r in rows:
        k = r.matricule.casefold()
        if k in nouveaux:
            nouveaux.discard(k)
            db.execute(update(Salarie).where(Salarie.id == salaries[k]).values(
                service_id=ids["service"][r.donnees["service"]],
                site_id=ids["site"][r.donnees["site"]],
                activite_id=ids["activite"][r.donnees["activite"]],
                type_contrat_id=ids["type_contrat"][r.donnees["type_contrat"]],
                poste_id=postes.get(norm(r.donnees["poste"])) if r.donnees.get("poste") else None))

    # archive puis remplacement par clé (période, salarié)
    pids = set(periodes[k] for k in cles_periodes)
    sids = {salaries[r.matricule.casefold()] for r in rows}
    existantes = list(db.scalars(select(SituationMensuelle).where(
        SituationMensuelle.periode_id.in_(pids), SituationMensuelle.salarie_id.in_(sids))))
    cles_fichier = {(periodes[(r.annee, r.mois)], salaries[r.matricule.casefold()]) for r in rows}
    a_remplacer = [s for s in existantes if (s.periode_id, s.salarie_id) in cles_fichier]
    if a_remplacer:
        db.execute(insert(LotImportPrecedent), [{
            "lot_id": lot.id, "periode_id": s.periode_id, "salarie_id": s.salarie_id,
            "etat": _snapshot(db, s)} for s in a_remplacer])
        sit_ids = [s.id for s in a_remplacer]
        db.execute(delete(Montant).where(Montant.situation_id.in_(sit_ids)))
        db.execute(delete(SituationMensuelle).where(SituationMensuelle.id.in_(sit_ids)))

    sits = [{
        "periode_id": periodes[(r.annee, r.mois)], "salarie_id": salaries[r.matricule.casefold()],
        "service_id": ids["service"][r.donnees["service"]], "site_id": ids["site"][r.donnees["site"]],
        "activite_id": ids["activite"][r.donnees["activite"]],
        "type_contrat_id": ids["type_contrat"][r.donnees["type_contrat"]],
        "poste_id": postes.get(norm(r.donnees["poste"])) if r.donnees.get("poste") else None,
        "lot_import_id": lot.id} for r in rows]
    res = db.execute(insert(SituationMensuelle).returning(
        SituationMensuelle.id, SituationMensuelle.periode_id, SituationMensuelle.salarie_id), sits)
    sit_id = {(p, s): i for i, p, s in res}
    montants = [{
        "situation_id": sit_id[(periodes[(r.annee, r.mois)], salaries[r.matricule.casefold()])],
        "rubrique_id": rub[nom], "valeur": Decimal(v)}
        for r in rows for nom, v in r.donnees["montants"].items()]
    if montants:
        db.execute(insert(Montant), montants)

    lot.statut, lot.valide_par, lot.valide_le = "valide", user_id, _now()
    audit.record(db, user_id, "import_valide", "lot_import", lot.id, None,
                 {"situations": len(sits), "montants": len(montants),
                  "remplacees": len(a_remplacer), "ignorees": ignorees})
    db.commit()
    return lot


def annuler_lot(db: Session, user_id: int, lot_id: int) -> LotImport:
    lot = _get_lot(db, lot_id, verrou=True)
    avant = lot.statut
    if lot.statut == "annule":
        raise HTTPException(409, "Lot déjà annulé")
    if lot.statut == "valide":
        _annuler_valide(db, lot)
    lot.statut, lot.annule_par, lot.annule_le = "annule", user_id, _now()
    audit.record(db, user_id, "import_annule", "lot_import", lot.id, {"statut": avant},
                 {"statut": "annule"})
    db.commit()
    return lot


def _annuler_valide(db: Session, lot: LotImport) -> None:
    mes = list(db.execute(select(SituationMensuelle.id, SituationMensuelle.periode_id,
                                 SituationMensuelle.salarie_id)
                          .where(SituationMensuelle.lot_import_id == lot.id)))
    attendu = db.scalar(select(func.count()).select_from(StagingLigne)
                        .where(StagingLigne.lot_id == lot.id))
    if len(mes) != attendu:
        raise HTTPException(409, "Annulation impossible : un lot validé plus tard a remplacé "
                                 "des lignes de ce lot (annuler d'abord ce lot).")
    sit_ids = [m.id for m in mes]
    db.execute(delete(Montant).where(Montant.situation_id.in_(sit_ids)))
    db.execute(delete(SituationMensuelle).where(SituationMensuelle.id.in_(sit_ids)))
    prec = list(db.scalars(select(LotImportPrecedent).where(LotImportPrecedent.lot_id == lot.id)))
    if not prec:
        return
    res = db.execute(insert(SituationMensuelle).returning(
        SituationMensuelle.id, SituationMensuelle.periode_id, SituationMensuelle.salarie_id), [{
            "periode_id": p.periode_id, "salarie_id": p.salarie_id,
            **{k: p.etat[k] for k in ("service_id", "site_id", "activite_id", "type_contrat_id",
                                      "poste_id", "lot_import_id")}} for p in prec])
    sid = {(p, s): i for i, p, s in res}
    montants = [{"situation_id": sid[(p.periode_id, p.salarie_id)], "rubrique_id": int(r),
                 "valeur": Decimal(v)} for p in prec for r, v in p.etat["montants"].items()]
    if montants:
        db.execute(insert(Montant), montants)
    db.execute(delete(LotImportPrecedent).where(LotImportPrecedent.lot_id == lot.id))
