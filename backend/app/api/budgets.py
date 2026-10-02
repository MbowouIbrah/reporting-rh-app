"""Budgets mensuels par rubrique, service et site (saisie, lecture, copie d'un mois)."""

from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api._commun import parse_montant
from app.db.session import get_db
from app.models.donnees import Periode
from app.models.pilotage import Budget
from app.models.referentiel import Rubrique, Service, Site
from app.repos.verrou import exiger_ouverte
from app.security import audit
from app.security.deps import current_principal
from app.security.policy import Principal, authorize

router = APIRouter(tags=["budgets"])

Axe = Literal["rubrique", "service", "site"]
MODELES = {"rubrique": Rubrique, "service": Service, "site": Site}


def _periode(db: Session, pid: int) -> Periode:
    per = db.get(Periode, pid)
    if per is None:
        raise HTTPException(404, "Période introuvable")
    return per


def _valeurs(db: Session, pid: int) -> dict[str, dict[int, str]]:
    out: dict[str, dict[int, str]] = {a: {} for a in MODELES}
    for b in db.scalars(select(Budget).where(Budget.periode_id == pid)):
        out[b.axe][b.cible_id] = format(Decimal(str(b.valeur)), "f")
    return out


def _vue(db: Session, per: Periode) -> dict:
    vals = _valeurs(db, per.id)
    lignes: dict[str, list[dict]] = {}
    for axe, model in MODELES.items():
        q = select(model).order_by(model.ordre if axe == "rubrique" else model.id)
        if axe == "rubrique":
            q = q.where(Rubrique.unite == "FCFA")
        lignes[axe] = [
            {"cible_id": r.id, "libelle": r.libelle, "actif": r.actif,
             "valeur": vals[axe].get(r.id)}
            for r in db.scalars(q) if r.actif or r.id in vals[axe]
        ]
    return {"periode_id": per.id, "annee": per.annee, "mois": per.mois, "statut": per.statut,
            "lignes": lignes}


@router.get("/budgets")
def lire(
    periode_id: int = Query(), p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    authorize(p, "import:read")
    return _vue(db, _periode(db, periode_id))


class LigneIn(BaseModel):
    axe: Axe
    cible_id: int
    valeur: str | None


class BudgetsIn(BaseModel):
    lignes: list[LigneIn] = Field(max_length=1000)


@router.put("/budgets/{pid}")
def saisir(
    pid: int, body: BudgetsIn, p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    authorize(p, "saisie:write")
    per = _periode(db, pid)
    exiger_ouverte(db, pid)
    cles = [(x.axe, x.cible_id) for x in body.lignes]
    if len(set(cles)) != len(cles):
        raise HTTPException(422, "Cible en double")
    avant = _valeurs(db, pid)
    for x in body.lignes:
        cible = db.get(MODELES[x.axe], x.cible_id)
        if cible is None:
            raise HTTPException(422, "Cible inconnue")
        if x.axe == "rubrique" and cible.unite != "FCFA":
            raise HTTPException(422, "Budget possible sur une rubrique en FCFA uniquement")
        ligne = db.scalar(select(Budget).where(
            Budget.periode_id == pid, Budget.axe == x.axe, Budget.cible_id == x.cible_id))
        if x.valeur is None or not x.valeur.strip():
            if ligne is not None:
                db.delete(ligne)
            continue
        v = parse_montant(x.valeur)
        if ligne is None:
            db.add(Budget(periode_id=pid, axe=x.axe, cible_id=x.cible_id, valeur=v))
        else:
            ligne.valeur = v
    db.flush()
    audit.record(db, p.user_id, "saisie_budget", "periode", pid, avant, _valeurs(db, pid))
    db.commit()
    return _vue(db, per)


class Copie(BaseModel):
    depuis: int


@router.post("/budgets/{pid}/copie")
def copier(
    pid: int, body: Copie, p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    authorize(p, "saisie:write")
    per = _periode(db, pid)
    exiger_ouverte(db, pid)
    if body.depuis == pid:
        raise HTTPException(422, "Source identique à la cible")
    _periode(db, body.depuis)
    source = list(db.scalars(select(Budget).where(Budget.periode_id == body.depuis)))
    if not source:
        raise HTTPException(422, "Aucun budget à copier sur la période source")
    avant = _valeurs(db, pid)
    for b in db.scalars(select(Budget).where(Budget.periode_id == pid)):
        db.delete(b)
    db.flush()
    for b in source:
        db.add(Budget(periode_id=pid, axe=b.axe, cible_id=b.cible_id, valeur=b.valeur))
    db.flush()
    audit.record(db, p.user_id, "copie_budget", "periode", pid, avant,
                 {**_valeurs(db, pid), "depuis": body.depuis})
    db.commit()
    return _vue(db, per)
