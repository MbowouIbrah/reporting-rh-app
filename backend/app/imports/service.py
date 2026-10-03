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
    closes = {(p.annee, p.mois) for p in db.scalars(select(Periode).where(Periode.statut == "close"))}
    noms = {s.matricule_norm: norm(s.nom) for s in db.scalars(select(Salarie)) if s.nom}
    return Refs(
        services=index("service", Service), activites=index("activite", Activite),
        sites=index("site", Site), contrats=index("type_contrat", TypeContrat),
        rubriques=[(r.libelle, r.unite) for r in rubs], rubrique_alias=alias,
        postes=set(index("poste", Poste)), periodes_closes=closes, noms_connus=noms,
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


def valider_lot(db: Session, user_id: int, lot_id: int) -> LotImport:
    lot = _get_lot(db, lot_id, verrou=True)
    if lot.statut != "pret":
        raise HTTPException(409, f"Lot au statut « {lot.statut} » : validation impossible")
    if db.scalar(select(LotImport.id).where(LotImport.sha256 == lot.sha256,
                                            LotImport.statut == "valide")):
        raise HTTPException(409, "Fichier déjà importé")
    rows = list(db.scalars(select(StagingLigne).where(StagingLigne.lot_id == lot.id)))
    if not rows:
        raise HTTPException(409, "Lot vide")

    cles_periodes = {(r.annee, r.mois) for r in rows}
    closes = [p for p in db.scalars(select(Periode).where(Periode.statut == "close"))
              if (p.annee, p.mois) in cles_periodes]
    if closes:
        raise HTTPException(409, "Période close : " + ", ".join(f"{p.annee}-{p.mois:02d}"
                                                                for p in closes))

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
                  "remplacees": len(a_remplacer)})
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
    pids = {m.periode_id for m in mes}
    if db.scalar(select(Periode.id).where(Periode.id.in_(pids), Periode.statut == "close")):
        raise HTTPException(409, "Annulation impossible : une période concernée est close.")

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
