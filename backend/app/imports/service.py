"""Cycle de vie d'un lot : analyse (staging) -> validation explicite -> annulation."""

import hashlib
from datetime import UTC, datetime
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.orm import Session

from app.imports.lecture import Feuille, FichierIllisible, lire
from app.imports.regles import BLOQUANT, Refs, norm, valider
from app.models.donnees import Montant, Periode, Salarie, SituationMensuelle
from app.models.imports import ImportAnomalie, LotImport, LotImportPrecedent, StagingLigne
from app.models.referentiel import (
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
    try:
        feuille = lire(contenu)
    except FichierIllisible as e:
        raise HTTPException(422, str(e)) from None
    return analyser_feuille(db, user_id, nom, feuille, sha, len(contenu))


def analyser_feuille(db: Session, user_id: int, nom: str, feuille: Feuille, sha: str,
                     taille: int) -> LotImport:
    lignes, anos, stats = valider(feuille, charger_refs(db))
    nb_b = sum(1 for a in anos if a.gravite == BLOQUANT)
    lot = LotImport(
        fichier_nom=nom[:255], sha256=sha, taille=taille, cree_par=user_id,
        statut="rejete" if nb_b else "pret", nb_lignes=len(lignes), nb_bloquants=nb_b,
        nb_avert=len(anos) - nb_b, stats=stats,
    )
    db.add(lot)
    db.flush()
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
    audit.record(db, user_id, "import_analyse", "lot_import", lot.id, None,
                 {"statut": lot.statut, "fichier": lot.fichier_nom, **(stats or {})})
    db.commit()
    return lot


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
