from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.imports.regles import norm
from app.imports.service import DIM_MODELS
from app.models.donnees import Periode
from app.models.referentiel import RefAlias, Rubrique
from app.security import audit
from app.security.deps import current_principal
from app.security.policy import Principal, authorize

router = APIRouter(tags=["periodes"])


def _periode(p: Periode) -> dict:
    return {"id": p.id, "annee": p.annee, "mois": p.mois, "statut": p.statut,
            "close_le": p.close_le.isoformat() if p.close_le else None}


@router.get("/periodes")
def liste(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    authorize(p, "import:read")
    return [_periode(x) for x in db.scalars(select(Periode).order_by(Periode.annee, Periode.mois))]


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
    avant = _periode(per)
    per.statut, per.close_le, per.close_par = "close", datetime.now(UTC), p.user_id
    audit.record(db, p.user_id, "cloture", "periode", pid, avant, _periode(per))
    db.commit()
    return _periode(per)


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
    avant = _periode(per)
    per.statut, per.close_le, per.close_par = "ouverte", None, None
    audit.record(db, p.user_id, "reouverture", "periode", pid, avant,
                 {**_periode(per), "motif": body.motif.strip()})
    db.commit()
    return _periode(per)


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
