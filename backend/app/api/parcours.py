"""Parcours de fin de mois : statut de chaque étape, calculé depuis les données existantes."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.rapports import _mensuel
from app.db.session import get_db
from app.kpi import chargement as ch
from app.models.donnees import Periode, Salarie, SituationMensuelle
from app.models.imports import LotImport, StagingLigne
from app.models.pilotage import Budget, CaPeriode
from app.security.deps import current_principal
from app.security.policy import Principal, authorize

router = APIRouter(tags=["parcours"])


def _salaries(db: Session, annee: int, mois: int) -> dict[int, dict]:
    rows = db.execute(
        select(Salarie.id, Salarie.matricule, Salarie.nom)
        .join(SituationMensuelle, SituationMensuelle.salarie_id == Salarie.id)
        .join(Periode, Periode.id == SituationMensuelle.periode_id)
        .where(Periode.annee == annee, Periode.mois == mois)
        .order_by(Salarie.matricule)
    )
    return {r.id: {"matricule": r.matricule, "nom": r.nom} for r in rows}


def _etape(cle: str, libelle: str, statut: str, resume: str) -> dict:
    return {"cle": cle, "libelle": libelle, "statut": statut, "resume": resume}


@router.get("/parcours")
def parcours(
    annee: int = Query(ge=2000, le=2100),
    mois: int = Query(ge=1, le=12),
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    authorize(p, "saisie:write")
    per = db.scalar(select(Periode).where(Periode.annee == annee, Periode.mois == mois))
    if per is None:
        return {
            "annee": annee, "mois": mois, "existe": False, "periode_id": None, "ca": None,
            "effectifs": {"total": 0, "entrees": [], "sorties": []},
            "etapes": [
                _etape("mois", "Mois", "a_faire", "Ouvrez le mois pour commencer"),
                _etape("donnees", "Données de paie", "a_faire", "—"),
                _etape("controles", "Contrôles", "a_faire", "—"),
                _etape("ca", "Chiffre d’affaires", "reportable", "—"),
                _etape("budgets", "Budgets", "facultatif", "—"),
            ],
        }

    cur = _salaries(db, annee, mois)
    pa, pm = ch.precedente(annee, mois)
    prev = _salaries(db, pa, pm)
    entrees = [v for k, v in cur.items() if k not in prev] if prev and cur else []
    sorties = [v for k, v in prev.items() if k not in cur] if prev and cur else []

    en_attente = db.scalar(
        select(func.count(func.distinct(LotImport.id)))
        .join(StagingLigne, StagingLigne.lot_id == LotImport.id)
        .where(LotImport.statut == "pret", StagingLigne.annee == annee, StagingLigne.mois == mois)
    )
    if not cur:
        donnees = _etape("donnees", "Données de paie", "a_faire", "Aucune donnée pour ce mois")
    else:
        resume = f"{len(cur)} employés · {len(entrees)} entrée(s) · {len(sorties)} départ(s)"
        if en_attente:
            resume = f"{en_attente} import(s) à valider · " + resume
        donnees = _etape("donnees", "Données de paie", "a_revoir" if en_attente else "fait", resume)

    if not cur:
        controles = _etape("controles", "Contrôles", "a_faire", "En attente des données")
    else:
        try:
            res = _mensuel(db, p, annee, mois, None, None)
            bloquants = sum(1 for c in res.get("controles", []) if c["bloquant"])
        except HTTPException:
            bloquants = 0
        controles = _etape(
            "controles", "Contrôles", "a_revoir" if bloquants else "fait",
            f"{bloquants} écart(s) bloquant(s)" if bloquants else "Tous les contrôles sont bons",
        )

    ca = db.scalar(select(CaPeriode.valeur).where(CaPeriode.periode_id == per.id))
    nb_budgets = db.scalar(
        select(func.count()).select_from(Budget).where(Budget.periode_id == per.id)
    )
    return {
        "annee": annee, "mois": mois, "existe": True, "periode_id": per.id,
        "ca": None if ca is None else format(ca, "f"),
        "effectifs": {"total": len(cur), "entrees": entrees, "sorties": sorties},
        "etapes": [
            _etape("mois", "Mois", "fait", "Mois ouvert"),
            donnees,
            controles,
            _etape("ca", "Chiffre d’affaires", "fait" if ca is not None else "reportable",
                   "CA saisi" if ca is not None else "À saisir quand il est connu"),
            _etape("budgets", "Budgets", "fait" if nb_budgets else "facultatif",
                   f"{nb_budgets} ligne(s) de budget" if nb_budgets else "Facultatif"),
        ],
    }
