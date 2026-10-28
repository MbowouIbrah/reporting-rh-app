"""Rubriques, règles d'exclusion datées et paramètres datés (jours_ouvres, budget_employe).

Une ligne datée n'est jamais modifiée : on pose une `date_fin` (règles) ou on crée une valeur
plus récente (paramètres). Chaque écriture est tracée au journal d'audit."""

from datetime import date
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.kpi.chargement import rubriques_exclues
from app.kpi.moteur import ABSENCES, COMMISSION, PRIMES
from app.models.pilotage import Parametre
from app.models.referentiel import Rubrique, RubriqueRegle
from app.referentiels_init import DEBUT
from app.security import audit
from app.security.deps import current_principal
from app.security.policy import Principal, authorize

router = APIRouter(tags=["parametrage"])

CLES = ("jours_ouvres", "budget_employe")
REGLES = ("exclu_total_ligne", "exclu_total_general")
MOTEUR = {ABSENCES, COMMISSION, *PRIMES}


def _regle(r: RubriqueRegle) -> dict:
    return {"id": r.id, "rubrique_id": r.rubrique_id, "regle": r.regle,
            "date_debut": r.date_debut.isoformat(),
            "date_fin": r.date_fin.isoformat() if r.date_fin else None}


def _param(x: Parametre) -> dict:
    return {"id": x.id, "cle": x.cle, "valeur": format(Decimal(str(x.valeur)), "f"),
            "date_debut": x.date_debut.isoformat()}


def _rubrique(r: Rubrique) -> dict:
    return {"id": r.id, "libelle": r.libelle, "unite": r.unite, "ordre": r.ordre,
            "actif": r.actif, "moteur": r.libelle in MOTEUR, "nature": r.nature}


@router.get("/parametrage")
def lire(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    authorize(p, "import:read")
    return {
        "rubriques": [_rubrique(r) for r in db.scalars(select(Rubrique).order_by(Rubrique.ordre))],
        "regles": [_regle(r) for r in db.scalars(
            select(RubriqueRegle).order_by(RubriqueRegle.rubrique_id, RubriqueRegle.date_debut))],
        "parametres": [_param(x) for x in db.scalars(
            select(Parametre).order_by(Parametre.cle, Parametre.date_debut))],
    }


# ---- rubriques ----
class RubriqueIn(BaseModel):
    libelle: str
    unite: str
    ordre: int | None = None
    nature: str = "paie"


@router.post("/parametrage/rubriques", status_code=201)
def creer_rubrique(
    body: RubriqueIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)
):
    authorize(p, "referentiel:write")
    lib = body.libelle.strip()
    if not lib:
        raise HTTPException(422, "Libellé vide")
    if body.unite not in ("FCFA", "jours", "nombre"):
        raise HTTPException(422, "Unité invalide (FCFA, jours ou nombre)")
    if body.nature not in ("paie", "activite"):
        raise HTTPException(422, "Nature invalide (paie ou activite)")
    if body.nature == "paie" and body.unite == "nombre":
        raise HTTPException(422, "Une rubrique de paie est en FCFA ou en jours")
    if db.scalar(select(Rubrique.id).where(Rubrique.libelle == lib)):
        raise HTTPException(409, "Libellé déjà utilisé")
    ordre = body.ordre
    if ordre is None:
        dernier = db.scalar(select(Rubrique.ordre).order_by(Rubrique.ordre.desc()).limit(1))
        ordre = (dernier or 0) + 1
    r = Rubrique(libelle=lib, unite=body.unite, ordre=ordre, actif=True,
                 nature=body.nature)
    db.add(r)
    db.flush()
    audit.record(db, p.user_id, "create", "rubrique", r.id, None, _rubrique(r))
    db.commit()
    return _rubrique(r)


class RubriquePatch(BaseModel):
    ordre: int | None = None
    actif: bool | None = None


@router.put("/parametrage/rubriques/{rid}")
def modifier_rubrique(
    rid: int, body: RubriquePatch, p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    authorize(p, "referentiel:write")
    r = db.get(Rubrique, rid)
    if r is None:
        raise HTTPException(404, "Rubrique introuvable")
    avant = _rubrique(r)
    if body.actif is False and r.libelle in MOTEUR:
        raise HTTPException(409, "Rubrique utilisée par le moteur KPI : désactivation interdite")
    if body.actif is not None and body.actif != r.actif:
        r.actif = body.actif
    if body.ordre is not None:
        r.ordre = body.ordre
    db.flush()
    audit.record(db, p.user_id, "update", "rubrique", rid, avant, _rubrique(r))
    db.commit()
    return _rubrique(r)


# ---- ordre et hachuré des colonnes (Individuel et DONNEES, un ordre pour tous) ----
class ColonneIn(BaseModel):
    rubrique: str
    exclu: bool


class ColonnesIn(BaseModel):
    colonnes: list[ColonneIn]


def _colonnes(rubriques: list[Rubrique], exclues: frozenset[str]) -> list[dict]:
    return [{"rubrique": r.libelle, "ordre": r.ordre, "exclu": r.libelle in exclues}
            for r in rubriques]


@router.put("/parametrage/colonnes")
def ordonner_colonnes(
    body: ColonnesIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)
):
    """Les rubriques reçues reprennent, dans l'ordre reçu, les places qu'elles occupaient (une page
    n'envoie que ses colonnes, les autres ne bougent pas). Une rubrique qui change de zone sort du
    TOTAL ou y revient sur tout l'historique : ses règles d'exclusion datées sont remplacées."""
    authorize(p, "referentiel:write")
    toutes = list(db.scalars(select(Rubrique).order_by(Rubrique.ordre, Rubrique.id)))
    par_lib = {r.libelle: r for r in toutes}
    libs = [c.rubrique for c in body.colonnes]
    if not libs or len(set(libs)) != len(libs) or any(x not in par_lib for x in libs):
        raise HTTPException(422, "Colonnes invalides")
    if any(par_lib[x].nature != "paie" for x in libs):
        raise HTTPException(422, "Une rubrique d'activité n'est pas une colonne de paie")
    if any(not c.exclu and par_lib[c.rubrique].unite != "FCFA" for c in body.colonnes):
        raise HTTPException(422, "Une rubrique en jours ne peut pas entrer dans le TOTAL")
    exclues = rubriques_exclues(db)
    avant = _colonnes([r for r in toutes if r.nature == "paie"], exclues)
    recues = set(libs)
    places = iter([i for i, r in enumerate(toutes) if r.libelle in recues])
    for lib in libs:
        toutes[next(places)] = par_lib[lib]
    for i, r in enumerate(toutes, start=1):
        r.ordre = i
    for c in body.colonnes:
        if c.exclu == (c.rubrique in exclues):
            continue
        rid = par_lib[c.rubrique].id
        db.execute(delete(RubriqueRegle).where(RubriqueRegle.rubrique_id == rid,
                                               RubriqueRegle.regle == "exclu_total_ligne"))
        if c.exclu:
            db.add(RubriqueRegle(rubrique_id=rid, regle="exclu_total_ligne", date_debut=DEBUT))
    db.flush()
    apres = _colonnes([r for r in toutes if r.nature == "paie"], rubriques_exclues(db))
    audit.record(db, p.user_id, "update", "colonnes", None, {"colonnes": avant},
                 {"colonnes": apres})
    db.commit()
    return {"colonnes": apres}


# ---- règles d'exclusion datées ----
class RegleIn(BaseModel):
    rubrique_id: int
    regle: str
    date_debut: date


@router.post("/parametrage/regles", status_code=201)
def creer_regle(
    body: RegleIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)
):
    authorize(p, "referentiel:write")
    if body.regle not in REGLES:
        raise HTTPException(422, "Règle inconnue")
    rub = db.get(Rubrique, body.rubrique_id)
    if rub is None:
        raise HTTPException(404, "Rubrique introuvable")
    if rub.nature != "paie":
        raise HTTPException(422, "Une rubrique d'activité n'entre pas dans le total de paie")
    # chevauchement avec une règle identique encore active à partir de la date de début
    for r in db.scalars(select(RubriqueRegle).where(
            RubriqueRegle.rubrique_id == body.rubrique_id, RubriqueRegle.regle == body.regle)):
        if r.date_fin is None or r.date_fin >= body.date_debut:
            raise HTTPException(409, "Une règle identique est déjà active à cette date : "
                                     "poser d'abord sa date de fin")
    r = RubriqueRegle(rubrique_id=body.rubrique_id, regle=body.regle, date_debut=body.date_debut)
    db.add(r)
    db.flush()
    audit.record(db, p.user_id, "create", "rubrique_regle", r.id, None, _regle(r))
    db.commit()
    return _regle(r)


class FinIn(BaseModel):
    date_fin: date


@router.post("/parametrage/regles/{rid}/fin")
def terminer_regle(
    rid: int, body: FinIn, p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    authorize(p, "referentiel:write")
    r = db.get(RubriqueRegle, rid)
    if r is None:
        raise HTTPException(404, "Règle introuvable")
    if r.date_fin is not None:
        raise HTTPException(409, "Règle déjà terminée")
    if body.date_fin < r.date_debut:
        raise HTTPException(422, "Date de fin antérieure au début")
    # mois touchés : ceux dont le 1er jour est après date_fin
    avant = _regle(r)
    r.date_fin = body.date_fin
    db.flush()
    audit.record(db, p.user_id, "update", "rubrique_regle", rid, avant, _regle(r))
    db.commit()
    return _regle(r)


# ---- paramètres datés ----
class ParamIn(BaseModel):
    cle: str
    valeur: str
    date_debut: date


@router.post("/parametrage/parametres", status_code=201)
def creer_parametre(
    body: ParamIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)
):
    authorize(p, "referentiel:write")
    if body.cle not in CLES:
        raise HTTPException(422, "Paramètre inconnu")
    try:
        v = Decimal(body.valeur.strip().replace(",", "."))
    except InvalidOperation:
        raise HTTPException(422, "Valeur invalide") from None
    if not v.is_finite() or v <= 0 or v >= Decimal("1e15"):
        raise HTTPException(422, "Valeur invalide")
    if body.cle == "jours_ouvres" and v > 31:
        raise HTTPException(422, "Jours ouvrés : 31 au plus")
    if db.scalar(select(Parametre.id).where(
            Parametre.cle == body.cle, Parametre.date_debut == body.date_debut)):
        raise HTTPException(409, "Une valeur existe déjà à cette date (non modifiable)")
    x = Parametre(cle=body.cle, valeur=v.quantize(Decimal("0.001")), date_debut=body.date_debut)
    db.add(x)
    db.flush()
    audit.record(db, p.user_id, "create", "parametre", x.id, None, _param(x))
    db.commit()
    return _param(x)
