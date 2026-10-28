"""Pilotage manuel du mois (feuilles RÉSUMÉ et MENSUEL de l'Excel) : CA, marge, budgets, et
saisie de l'activité (OR, devis, factures) par site et service.

La lecture ne crée jamais de période ; une écriture ouvre le mois s'il ne l'est pas encore.
"""

import re
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import false, select
from sqlalchemy.orm import Session

from app.api._commun import parse_montant
from app.api.budgets import MODELES, LigneIn, _valeurs, ecrire_budgets, valider_lignes
from app.api.periodes import MARGE_SANS_CA, ecrire_ca_marge, periode_ou_ouvrir
from app.db.session import get_db
from app.kpi import formules as f
from app.kpi.chargement import exclues_a_date
from app.models.donnees import Periode
from app.models.pilotage import ActiviteSaisie, Budget, CaPeriode
from app.models.referentiel import Rubrique, Service, Site
from app.repos.scope import Scope, apply_scope, scope_for
from app.security import audit
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
            q = q.where(Rubrique.unite == "FCFA", Rubrique.nature == "paie")
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


INDICATEURS_ACTIVITE = ("or", "devis", "factures")
_VALEUR = re.compile(r"\d{1,15}([.,]\d{1,12})?")


def _periode_id(db: Session, annee: int, mois: int) -> int | None:
    return db.scalar(select(Periode.id).where(Periode.annee == annee, Periode.mois == mois))


def _restreint(scope: Scope, dim: str, col):
    """Condition d'un référentiel au périmètre (comme `charger_refs`) ; aucune règle = rien."""
    if scope.unrestricted:
        return None
    if not scope.rules:
        return false()
    return col.in_(scope.rules[dim]) if dim in scope.rules else None


def _vue_activite(db: Session, scope: Scope, annee: int, mois: int) -> dict:
    pid = _periode_id(db, annee, mois)
    q = apply_scope(
        select(ActiviteSaisie.site_id, ActiviteSaisie.service_id, ActiviteSaisie.indicateur,
               ActiviteSaisie.valeur)
        .select_from(ActiviteSaisie)
        .join(Site, Site.id == ActiviteSaisie.site_id)
        .join(Service, Service.id == ActiviteSaisie.service_id)
        .where(ActiviteSaisie.periode_id == pid)
        .order_by(ActiviteSaisie.site_id, ActiviteSaisie.service_id, ActiviteSaisie.indicateur),
        scope, service=Service.libelle, site=Site.libelle)
    valeurs = [{"site_id": si, "service_id": se, "indicateur": ind,
                "valeur": format(Decimal(str(v)), "f")}
               for si, se, ind, v in db.execute(q)] if pid is not None else []
    avec_valeur_site = {x["site_id"] for x in valeurs}
    avec_valeur_service = {x["service_id"] for x in valeurs}

    def liste(model, dim, avec_valeur):
        q = select(model).order_by(model.id)
        cond = _restreint(scope, dim, model.libelle)
        if cond is not None:
            q = q.where(cond)
        return [r for r in db.scalars(q) if r.actif or r.id in avec_valeur]

    return {
        "annee": annee, "mois": mois, "periode_id": pid,
        "sites": [{"id": r.id, "libelle": r.libelle}
                  for r in liste(Site, "site", avec_valeur_site)],
        "services": [{"id": r.id, "libelle": r.libelle, "productif": r.productif}
                     for r in liste(Service, "service", avec_valeur_service)],
        "valeurs": valeurs,
    }


@router.get("/activite")
def lire_activite(
    annee: int = Query(ge=2000, le=2100), mois: int = Query(ge=1, le=12),
    p: Principal = Depends(current_principal), db: Session = Depends(get_db),
):
    authorize(p, "import:read")
    return _vue_activite(db, scope_for(db, p), annee, mois)


class LigneActiviteIn(BaseModel):
    site_id: int
    service_id: int
    indicateur: str
    valeur: str | None


class ActiviteIn(Mois):
    lignes: list[LigneActiviteIn] = Field(max_length=5000)


def _valeur_activite(s: str | None) -> Decimal | None:
    """Valeur saisie (virgule ou point), exacte, positive ou nulle ; vide = ligne supprimée."""
    if s is None or not s.strip():
        return None
    t = s.strip()
    if not _VALEUR.fullmatch(t):
        raise HTTPException(422, "Valeur invalide")
    return Decimal(t.replace(",", "."))


def _valider_activite(db: Session, lignes: list[LigneActiviteIn]) -> list[tuple]:
    """Contrôle toutes les lignes avant toute écriture : (site_id, service_id, indicateur,
    valeur ou None si effacée)."""
    cles = [(x.site_id, x.service_id, x.indicateur) for x in lignes]
    if len(set(cles)) != len(cles):
        raise HTTPException(422, "Ligne en double")
    sites = {i for i in db.scalars(select(Site.id))}
    services = {i for i in db.scalars(select(Service.id))}
    out = []
    for x in lignes:
        if x.indicateur not in INDICATEURS_ACTIVITE:
            raise HTTPException(422, "Indicateur inconnu")
        if x.site_id not in sites or x.service_id not in services:
            raise HTTPException(422, "Site ou service inconnu")
        out.append((x.site_id, x.service_id, x.indicateur, _valeur_activite(x.valeur)))
    return out


def _verifier_perimetre(db: Session, scope: Scope, valides: list[tuple]) -> None:
    """403 si un couple site / service sort du périmètre (avant toute écriture)."""
    if scope.unrestricted or not valides:
        return
    sites, services = {v[0] for v in valides}, {v[1] for v in valides}
    q = apply_scope(select(Site.id, Service.id).where(Site.id.in_(sites), Service.id.in_(services)),
                    scope, service=Service.libelle, site=Site.libelle)
    permis = {(si, se) for si, se in db.execute(q)}
    if any((si, se) not in permis for si, se, _i, _v in valides):
        raise HTTPException(403, "Accès refusé")


def _valeurs_activite(db: Session, pid: int) -> dict[str, Decimal]:
    q = select(ActiviteSaisie).where(ActiviteSaisie.periode_id == pid)
    return {f"{r.site_id}/{r.service_id}/{r.indicateur}": Decimal(str(r.valeur))
            for r in db.scalars(q)}


def _ecrire_activite(db: Session, p: Principal, pid: int, valides: list[tuple]) -> None:
    """Upsert (None = ligne supprimée), avec trace d'audit. Pas de commit."""
    avant = _valeurs_activite(db, pid)
    existantes = {(r.site_id, r.service_id, r.indicateur): r for r in db.scalars(
        select(ActiviteSaisie).where(ActiviteSaisie.periode_id == pid))}
    for si, se, ind, v in valides:
        ligne = existantes.get((si, se, ind))
        if v is None:
            if ligne is not None:
                db.delete(ligne)
        elif ligne is None:
            db.add(ActiviteSaisie(periode_id=pid, site_id=si, service_id=se, indicateur=ind,
                                  valeur=v))
        else:
            ligne.valeur = v
    db.flush()
    apres = _valeurs_activite(db, pid)
    if apres != avant:  # comparaison numérique : 7 et 7.000 sont la même valeur
        audit.record(db, p.user_id, "saisie_activite", "periode", pid,
                     {k: format(v, "f") for k, v in avant.items()},
                     {k: format(v, "f") for k, v in apres.items()})


@router.put("/activite")
def saisir_activite(
    body: ActiviteIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db),
):
    authorize(p, "saisie:write")
    scope = scope_for(db, p)
    valides = _valider_activite(db, body.lignes)  # 422 avant toute ouverture du mois
    _verifier_perimetre(db, scope, valides)
    if _periode_id(db, body.annee, body.mois) is None and all(v[3] is None for v in valides):
        return _vue_activite(db, scope, body.annee, body.mois)
    per = periode_ou_ouvrir(db, p, body.annee, body.mois)
    _ecrire_activite(db, p, per.id, valides)
    db.commit()
    return _vue_activite(db, scope, body.annee, body.mois)
