"""Pilotage manuel du mois (feuilles RÉSUMÉ et MENSUEL de l'Excel) : CA, marge et budgets.

La lecture ne crée jamais de période ; une écriture ouvre le mois s'il ne l'est pas encore.
"""

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api._commun import parse_montant
from app.api.budgets import MODELES, LigneIn, _valeurs, ecrire_budgets, valider_lignes
from app.api.periodes import MARGE_SANS_CA, ecrire_ca_marge, periode_ou_ouvrir
from app.db.session import get_db
from app.kpi import formules as f
from app.kpi.chargement import exclues_a_date
from app.models.donnees import Periode
from app.models.pilotage import Budget, CaPeriode
from app.models.referentiel import Rubrique
from app.security.deps import current_principal
from app.security.policy import Principal, authorize

router = APIRouter(prefix="/pilotage", tags=["pilotage"])


def _txt(v) -> str | None:
    return None if v is None else format(Decimal(str(v)), "f")


def _somme(vals) -> str | None:
    vals = [Decimal(v) for v in vals if v is not None]
    return format(sum(vals, Decimal(0)), "f") if vals else None


def _reprise(db: Session, annee: int, mois: int) -> dict | None:
    """Budgets du dernier mois antérieur qui en a : proposés en pré-remplissage seulement."""
    pid = db.scalar(
        select(Periode.id).join(Budget, Budget.periode_id == Periode.id)
        .where((Periode.annee < annee) | ((Periode.annee == annee) & (Periode.mois < mois)))
        .order_by(Periode.annee.desc(), Periode.mois.desc()).limit(1))
    if pid is None:
        return None
    per = db.get(Periode, pid)
    vals = _valeurs(db, pid)
    return {"annee": per.annee, "mois": per.mois,
            "valeurs": {axe: {str(k): v for k, v in d.items()} for axe, d in vals.items()}}


def _vue(db: Session, annee: int, mois: int) -> dict:
    per = db.scalar(select(Periode).where(Periode.annee == annee, Periode.mois == mois))
    saisie = db.get(CaPeriode, per.id) if per else None
    ca = Decimal(str(saisie.valeur)) if saisie else None
    marge = Decimal(str(saisie.marge)) if saisie and saisie.marge is not None else None
    taux = f.taux_marge(ca, marge)
    vals = _valeurs(db, per.id) if per else {a: {} for a in MODELES}
    exclues = exclues_a_date(db, annee, mois)
    budgets: dict[str, list[dict]] = {}
    totaux: dict[str, str | None] = {}
    for axe, model in MODELES.items():
        q = select(model).order_by(model.ordre if axe == "rubrique" else model.id)
        if axe == "rubrique":
            q = q.where(Rubrique.unite == "FCFA")
        budgets[axe] = [
            {"cible_id": r.id, "libelle": r.libelle, "actif": r.actif,
             "exclue": axe == "rubrique" and r.libelle in exclues,
             "valeur": vals[axe].get(r.id)}
            for r in db.scalars(q) if r.actif or r.id in vals[axe]
        ]
        # total du MENSUEL : rubriques exclues du TOTAL CHARGES hors somme
        totaux[axe] = _somme(x["valeur"] for x in budgets[axe] if not x["exclue"])
    return {
        "annee": annee, "mois": mois, "periode_id": per.id if per else None,
        "ca": _txt(ca), "marge": _txt(marge),
        "taux_marge": taux if isinstance(taux, str) or taux is None else str(taux),
        "budgets": budgets, "totaux": totaux,
        "reprise": None if any(vals.values()) else _reprise(db, annee, mois),
    }


@router.get("")
def lire(
    annee: int = Query(ge=2000, le=2100), mois: int = Query(ge=1, le=12),
    p: Principal = Depends(current_principal), db: Session = Depends(get_db),
):
    authorize(p, "import:read")
    authorize(p, "marge:read")
    return _vue(db, annee, mois)


class Mois(BaseModel):
    annee: int = Field(ge=2000, le=2100)
    mois: int = Field(ge=1, le=12)


class CaMargeIn(Mois):
    ca: str | None
    marge: str | None


def _montant(s: str | None, negatif: bool = False) -> Decimal | None:
    return None if s is None or not s.strip() else parse_montant(s, negatif)


@router.put("/ca-marge")
def saisir_ca_marge(
    body: CaMargeIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db),
):
    authorize(p, "saisie:write")
    authorize(p, "marge:read")
    ca, marge = _montant(body.ca), _montant(body.marge, negatif=True)
    if ca is None and marge is not None:  # avant toute ouverture du mois
        raise HTTPException(422, MARGE_SANS_CA)
    existe = db.scalar(select(Periode.id).where(Periode.annee == body.annee,
                                                Periode.mois == body.mois))
    if existe is None and ca is None:
        return _vue(db, body.annee, body.mois)  # rien à écrire : le mois n'est pas ouvert
    per = periode_ou_ouvrir(db, p, body.annee, body.mois)
    ecrire_ca_marge(db, p, per, ca, marge)
    db.commit()
    return _vue(db, body.annee, body.mois)


class BudgetsMoisIn(Mois):
    lignes: list[LigneIn] = Field(max_length=1000)


@router.put("/budgets")
def saisir_budgets(
    body: BudgetsMoisIn, p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    authorize(p, "saisie:write")
    authorize(p, "marge:read")
    valides = valider_lignes(db, body.lignes)  # 422 avant toute ouverture du mois
    existe = db.scalar(select(Periode.id).where(Periode.annee == body.annee,
                                                Periode.mois == body.mois))
    if existe is None and all(v is None for _x, v in valides):
        return _vue(db, body.annee, body.mois)
    per = periode_ou_ouvrir(db, p, body.annee, body.mois)
    ecrire_budgets(db, p, per.id, valides)
    db.commit()
    return _vue(db, body.annee, body.mois)
