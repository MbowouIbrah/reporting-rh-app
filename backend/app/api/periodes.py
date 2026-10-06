from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api._commun import parse_montant
from app.db.session import get_db
from app.imports.regles import norm
from app.imports.service import DIM_MODELS
from app.kpi.moteur import ABSENCES, COMMISSION, PRIMES
from app.models.auth import PerimetreRegle
from app.models.donnees import Periode
from app.models.pilotage import CaPeriode
from app.models.referentiel import RefAlias, Rubrique
from app.repos.verrou import exiger_ouverte
from app.security import audit
from app.security.deps import current_principal
from app.security.policy import Principal, authorize

router = APIRouter(tags=["periodes"])


def _ca(db: Session, pid: int) -> str | None:
    v = db.scalar(select(CaPeriode.valeur).where(CaPeriode.periode_id == pid))
    return None if v is None else format(Decimal(str(v)), "f")


def _periode(p: Periode, db: Session) -> dict:
    return {"id": p.id, "annee": p.annee, "mois": p.mois, "statut": p.statut,
            "close_le": p.close_le.isoformat() if p.close_le else None,
            "ca": _ca(db, p.id)}


@router.get("/periodes")
def liste(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    authorize(p, "import:read")
    rows = db.scalars(select(Periode).order_by(Periode.annee, Periode.mois))
    return [_periode(x, db) for x in rows]


class Mois(BaseModel):
    annee: int
    mois: int


@router.post("/periodes", status_code=201)
def ouvrir(body: Mois, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    authorize(p, "periode:write")
    if not (2000 <= body.annee <= 2100 and 1 <= body.mois <= 12):
        raise HTTPException(422, "Mois invalide")
    if db.scalar(select(Periode.id).where(Periode.annee == body.annee, Periode.mois == body.mois)):
        raise HTTPException(409, "Ce mois existe déjà")
    per = Periode(annee=body.annee, mois=body.mois)
    db.add(per)
    db.flush()
    audit.record(db, p.user_id, "ouverture", "periode", per.id, None, _periode(per, db))
    db.commit()
    return _periode(per, db)


def _get(db: Session, pid: int) -> Periode:
    per = db.get(Periode, pid)
    if per is None:
        raise HTTPException(404, "Période introuvable")
    return per


@router.post("/periodes/{pid}/cloturer")
def cloturer(pid: int, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    authorize(p, "periode:write")
    per = _get(db, pid)
    if per.statut == "close":
        raise HTTPException(409, "Période déjà close")
    avant = _periode(per, db)
    per.statut, per.close_le, per.close_par = "close", datetime.now(UTC), p.user_id
    audit.record(db, p.user_id, "cloture", "periode", pid, avant, _periode(per, db))
    db.commit()
    return _periode(per, db)


class Motif(BaseModel):
    motif: str


@router.post("/periodes/{pid}/rouvrir")
def rouvrir(
    pid: int, body: Motif, p: Principal = Depends(current_principal), db: Session = Depends(get_db)
):
    authorize(p, "periode:write")
    if len(body.motif.strip()) < 5:
        raise HTTPException(422, "Motif obligatoire (5 caractères minimum)")
    per = _get(db, pid)
    if per.statut != "close":
        raise HTTPException(409, "Période non close")
    avant = _periode(per, db)
    per.statut, per.close_le, per.close_par = "ouverte", None, None
    audit.record(db, p.user_id, "reouverture", "periode", pid, avant,
                 {**_periode(per, db), "motif": body.motif.strip()})
    db.commit()
    return _periode(per, db)


class Ca(BaseModel):
    valeur: str | None


@router.put("/periodes/{pid}/ca")
def saisir_ca(
    pid: int, body: Ca, p: Principal = Depends(current_principal), db: Session = Depends(get_db)
):
    authorize(p, "saisie:write")
    per = _get(db, pid)
    exiger_ouverte(db, pid)
    avant = _periode(per, db)
    ligne = db.get(CaPeriode, pid)
    if body.valeur is None or not body.valeur.strip():
        if ligne is not None:
            db.delete(ligne)
    else:
        v = parse_montant(body.valeur)
        if ligne is None:
            db.add(CaPeriode(periode_id=pid, valeur=v))
        else:
            ligne.valeur = v
    db.flush()
    audit.record(db, p.user_id, "saisie_ca", "periode", pid, avant, _periode(per, db))
    db.commit()
    return _periode(per, db)


# ---- référentiels et alias ----
def _modele(dimension: str):
    if dimension == "rubrique":
        return Rubrique
    if dimension not in DIM_MODELS:
        raise HTTPException(404, "Dimension inconnue")
    return DIM_MODELS[dimension]


@router.get("/referentiels/{dimension}")
def referentiel(
    dimension: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)
):
    authorize(p, "import:read")
    model = _modele(dimension)
    return {
        "valeurs": [{"id": r.id, "libelle": r.libelle, "actif": r.actif}
                    for r in db.scalars(select(model).order_by(model.id))],
        "alias": [{"alias": a.alias_norm, "cible_id": a.cible_id}
                  for a in db.scalars(select(RefAlias).where(RefAlias.dimension == dimension))],
    }


class AliasIn(BaseModel):
    alias: str
    cible_id: int


@router.post("/referentiels/{dimension}/alias", status_code=201)
def ajouter_alias(
    dimension: str, body: AliasIn, p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    authorize(p, "import:write")
    model = _modele(dimension)
    if db.get(model, body.cible_id) is None:
        raise HTTPException(404, "Cible introuvable")
    a = RefAlias(dimension=dimension, alias_norm=norm(body.alias), cible_id=body.cible_id)
    db.add(a)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Alias déjà défini") from None
    audit.record(db, p.user_id, "create", "ref_alias", a.id, None,
                 {"dimension": dimension, "alias": a.alias_norm, "cible_id": a.cible_id})
    db.commit()
    return {"alias": a.alias_norm, "cible_id": a.cible_id}


class RefPatch(BaseModel):
    libelle: str | None = None
    actif: bool | None = None


@router.put("/referentiels/{dimension}/{rid}")
def modifier_referentiel(
    dimension: str, rid: int, body: RefPatch, apercu: bool = False,
    p: Principal = Depends(current_principal), db: Session = Depends(get_db),
):
    """Renomme / (dés)active une valeur. Le renommage est propagé aux règles de périmètre
    et l'ancien libellé reste résolu à l'import (alias), dans la même transaction."""
    authorize(p, "referentiel:write")
    model = _modele(dimension)
    row = db.get(model, rid)
    if row is None:
        raise HTTPException(404, "Valeur introuvable")
    avant = {"libelle": row.libelle, "actif": row.actif}
    ancien = row.libelle
    nouveau = body.libelle.strip() if body.libelle is not None else ancien
    renomme = nouveau != ancien
    if renomme:
        if not nouveau:
            raise HTTPException(422, "Libellé vide")
        if dimension == "rubrique" and ancien in {ABSENCES, COMMISSION, *PRIMES}:
            raise HTTPException(409, "Rubrique utilisée par le moteur KPI : renommage interdit")
        if db.scalar(select(model.id).where(model.libelle == nouveau, model.id != rid)):
            raise HTTPException(409, "Libellé déjà utilisé")
        pris = db.scalar(select(RefAlias).where(
            RefAlias.dimension == dimension, RefAlias.alias_norm == norm(nouveau)))
        if pris is not None and pris.cible_id != rid:
            raise HTTPException(409, "Libellé déjà utilisé comme alias d'une autre valeur")
    regles = []
    if renomme and dimension in ("service", "site"):
        regles = list(db.scalars(select(PerimetreRegle).where(
            PerimetreRegle.dimension == dimension, PerimetreRegle.valeur == ancien)))
    if apercu:
        return {"perimetres_maj": len({r.perimetre_id for r in regles})}
    if body.actif is not None:
        row.actif = body.actif
    if renomme:
        row.libelle = nouveau
        for r in regles:
            r.valeur = nouveau
        if pris is not None:  # l'alias du nouveau libellé pointait déjà ici : devenu inutile
            db.delete(pris)
            db.flush()
        if not db.scalar(select(RefAlias.id).where(
                RefAlias.dimension == dimension, RefAlias.alias_norm == norm(ancien))):
            db.add(RefAlias(dimension=dimension, alias_norm=norm(ancien), cible_id=rid))
    db.flush()
    audit.record(db, p.user_id, "update", f"ref_{dimension}", rid, avant,
                 {"libelle": row.libelle, "actif": row.actif,
                  "perimetres_maj": len({r.perimetre_id for r in regles})})
    db.commit()
    return {"id": rid, "libelle": row.libelle, "actif": row.actif,
            "perimetres_maj": len({r.perimetre_id for r in regles})}
