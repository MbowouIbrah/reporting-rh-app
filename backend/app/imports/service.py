"""Cycle de vie d'un lot : analyse (staging) -> validation explicite -> annulation."""

import hashlib
from datetime import UTC, datetime
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.orm import Session

from app.imports.lecture import Feuille, FichierIllisible, lire
from app.imports.regles import (
    ATTRIBUTS,
    BLOQUANT,
    MOIS,
    Refs,
    colonnes,
    entetes_reconnus,
    est_sans_matricule,
    nombre,
    norm,
    texte,
    valider,
)
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
    return Refs(
        services=index("service", Service), activites=index("activite", Activite),
        sites=index("site", Site), contrats=index("type_contrat", TypeContrat),
        rubriques=[(r.libelle, r.unite) for r in rubs], rubrique_alias=alias,
        postes=set(index("poste", Poste)), noms_connus=noms,
        annuaire={s.matricule_norm: (s.matricule, s.nom) for s in salaries if s.nom},
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


def analyser(db: Session, user_id: int, nom: str, contenu: bytes) -> LotImport:
    sha = hashlib.sha256(contenu).hexdigest()
    existant = db.scalar(select(LotImport).where(
        LotImport.sha256 == sha, LotImport.statut.in_(("pret", "valide"))))
    if existant is not None:
        if existant.statut == "valide":
            raise HTTPException(409, {"message": "Fichier déjà importé", "lot_id": existant.id})
        return existant
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
            "lignes": [[n, [v(x) for x in row]] for n, row in f.lignes], "ligne_ignoree": f.ligne_ignoree}


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
    return lot


def _feuille_du_lot(lot: LotImport) -> Feuille:
    f = lot.feuille
    return Feuille(f["entete_ligne"], f["entetes"], [(n, tuple(r)) for n, r in f["lignes"]],
                   f["ligne_ignoree"])


DIM_REFS = {"service": "services", "activite": "activites", "site": "sites", "type_contrat": "contrats"}


def _refs_du_lot(db: Session, lot: LotImport, ajouts: dict | None = None) -> Refs:
    """Référentiels de la base, plus les valeurs que le lot propose d'ajouter (créées à la validation)."""
    refs = charger_refs(db)
    for dim, valeurs in (lot.feuille.get("ajouts", {}) if ajouts is None else ajouts).items():
        idx = getattr(refs, DIM_REFS[dim])
        for v in valeurs:
            idx[norm(v)] = v
    return refs


def _relancer(db: Session, lot: LotImport, feuille: Feuille, refs: Refs, **decisions) -> None:
    """Relance tous les contrôles ; les décisions du lot (ajouts, lignes retirées) sont conservées."""
    lignes, anos, stats = valider(feuille, refs)
    if lot.statut == "rejete" and _statut(anos) == "pret" and db.scalar(select(LotImport.id).where(
            LotImport.sha256 == lot.sha256, LotImport.id != lot.id,
            LotImport.statut.in_(("pret", "valide")))) is not None:
        raise HTTPException(409, "Ce fichier est déjà en vérification ou importé : reprendre ce lot-là.")
    gardees = {k: lot.feuille[k] for k in ("ajouts", "retirees") if k in lot.feuille}
    lot.feuille = {**_feuille_json(feuille), **gardees, **decisions}
    _ecrire(db, lot, lignes, anos, stats)


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


def _brut(x) -> str | None:
    """Valeur du fichier telle qu'on la retape : 1000.0 s'écrit 1000."""
    if isinstance(x, float) and x.is_integer():
        x = int(x)
    return None if x is None else str(x)


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


def propositions(db: Session, lot_id: int, anos) -> dict[int, dict]:
    """Aide à la décision pour chaque point : lignes du doublon, valeur du mois précédent,
    liste où ajouter une valeur inconnue. Clé : id du point."""
    nums = {a.num_ligne for a in anos if a.num_ligne and (
        a.code == "DOUBLON" or (a.code == "VALEUR_MANQUANTE" and a.colonne in COLONNES_REF))}
    rows = {r.num_ligne: r for r in db.scalars(select(StagingLigne).where(
        StagingLigne.lot_id == lot_id, StagingLigne.num_ligne.in_(nums)))} if nums else {}
    out: dict[int, dict] = {}
    for a in anos:
        if a.code == "REFERENTIEL_INCONNU" and a.colonne in COLONNES_REF:
            out[a.id] = {"dimension": COLONNES_REF[a.colonne][0]}
            continue
        r = rows.get(a.num_ligne)
        if r is None or r.annee is None or r.mois is None or not r.matricule:
            continue
        if a.code == "DOUBLON":
            q = select(StagingLigne.num_ligne).where(
                StagingLigne.lot_id == lot_id, StagingLigne.annee == r.annee,
                StagingLigne.mois == r.mois, func.lower(StagingLigne.matricule) == r.matricule.casefold())
            out[a.id] = {"lignes": sorted(db.scalars(q))}
        elif a.code == "VALEUR_MANQUANTE" and a.colonne in COLONNES_REF:
            _, model, attr = COLONNES_REF[a.colonne]
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
                out[a.id] = {"valeur": trouve[0], "periode": f"{MOIS[trouve[2] - 1].lower()} {trouve[1]}"}
    return out


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
