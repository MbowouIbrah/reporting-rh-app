from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api._commun import parse_montant
from app.api.rapports import COLONNES_INDIVIDUEL
from app.db.session import get_db
from app.imports.regles import norm
from app.imports.service import DIM_MODELS
from app.kpi.moteur import ABSENCES, COMMISSION, PRIMES
from app.models.auth import PerimetreRegle, UtilisateurPortee
from app.models.donnees import Periode
from app.models.pilotage import CaPeriode
from app.models.referentiel import TYPES_SITE, RefAlias, Rubrique
from app.security import audit
from app.security.deps import current_principal
from app.security.policy import Principal, authorize, is_allowed

router = APIRouter(tags=["periodes"])
MARGE_SANS_CA = "Une marge ne peut pas être saisie sans chiffre d'affaires"


def _txt(v) -> str | None:
    return None if v is None else format(Decimal(str(v)), "f")


def _periode(p: Periode, db: Session) -> dict:
    saisie = db.get(CaPeriode, p.id)
    return {"id": p.id, "annee": p.annee, "mois": p.mois,
            "ca": _txt(saisie.valeur) if saisie else None,
            "marge": _txt(saisie.marge) if saisie else None}


def periode_ou_ouvrir(db: Session, p: Principal, annee: int, mois: int) -> Periode:
    """Période du mois, ouverte (et tracée) si elle n'existe pas encore."""
    per = db.scalar(select(Periode).where(Periode.annee == annee, Periode.mois == mois))
    if per is None:
        authorize(p, "periode:write")  # même droit que POST /periodes
        per = Periode(annee=annee, mois=mois)
        db.add(per)
        db.flush()
        audit.record(db, p.user_id, "ouverture", "periode", per.id, None, _periode(per, db))
    return per


def ecrire_ca_marge(db: Session, p: Principal, per: Periode,
                    ca: Decimal | None, marge: Decimal | None) -> None:
    """Remplace CA et marge du mois (None = effacé), avec trace d'audit. Pas de commit."""
    if ca is None and marge is not None:
        raise HTTPException(422, MARGE_SANS_CA)
    avant = _periode(per, db)
    ligne = db.get(CaPeriode, per.id)
    if ca is None:
        if ligne is not None:
            db.delete(ligne)
    elif ligne is None:
        db.add(CaPeriode(periode_id=per.id, valeur=ca, marge=marge))
    else:
        ligne.valeur, ligne.marge = ca, marge
    db.flush()
    apres = _periode(per, db)
    if apres != avant:  # un envoi sans changement ne laisse pas de trace vide
        audit.record(db, p.user_id, "saisie_ca", "periode", per.id, avant, apres)


@router.get("/periodes")
def liste(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    authorize(p, "import:read")
    rows = db.scalars(select(Periode).order_by(Periode.annee, Periode.mois))
    marge = is_allowed(p, "marge:read")  # CA et marge : même règle que les rapports
    return [{k: v for k, v in _periode(x, db).items() if marge or k not in ("ca", "marge")}
            for x in rows]


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


class Ca(BaseModel):
    valeur: str | None


@router.put("/periodes/{pid}/ca")
def saisir_ca(
    pid: int, body: Ca, p: Principal = Depends(current_principal), db: Session = Depends(get_db)
):
    authorize(p, "saisie:write")
    authorize(p, "marge:read")
    per = _get(db, pid)
    ligne = db.get(CaPeriode, pid)
    vide = body.valeur is None or not body.valeur.strip()
    # la marge déjà saisie est conservée avec le CA, effacée avec lui
    ecrire_ca_marge(db, p, per, None if vide else parse_montant(body.valeur),
                    ligne.marge if ligne and not vide else None)
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
        "valeurs": [_valeur(dimension, r)
                    for r in db.scalars(select(model).order_by(model.id))],
        "alias": [{"alias": a.alias_norm, "cible_id": a.cible_id}
                  for a in db.scalars(select(RefAlias).where(RefAlias.dimension == dimension))],
    }


class RefIn(BaseModel):
    libelle: str
    type_site: str | None = None


def _valeur(dimension: str, r) -> dict:
    return {"id": r.id, "libelle": r.libelle, "actif": r.actif,
            **({"type_site": r.type_site} if dimension == "site" else {})}


@router.post("/referentiels/{dimension}", status_code=201)
def creer_referentiel(
    dimension: str, body: RefIn, p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    """Ajoute un service ou un site ; les autres dimensions naissent de l'import."""
    authorize(p, "referentiel:write")
    model = _modele(dimension)
    if dimension not in ("service", "site"):
        raise HTTPException(422, "Création possible pour les services et les sites seulement")
    libelle = body.libelle.strip()
    if not libelle:
        raise HTTPException(422, "Libellé vide")
    if body.type_site is not None and dimension != "site":
        raise HTTPException(422, "Type de site invalide")
    type_site = body.type_site or "principal"
    if type_site not in TYPES_SITE:
        raise HTTPException(422, "Type de site invalide")
    cle = norm(libelle)
    if any(norm(x) == cle for x in db.scalars(select(model.libelle))):
        raise HTTPException(409, "Libellé déjà utilisé")
    if db.scalar(select(RefAlias.id).where(
            RefAlias.dimension == dimension, RefAlias.alias_norm == cle)):
        raise HTTPException(409, "Libellé déjà utilisé comme alias d'une autre valeur")
    extra = {"type_site": type_site} if dimension == "site" else {}
    row = model(libelle=libelle, actif=True, **extra)
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Libellé déjà utilisé") from None
    audit.record(db, p.user_id, "create", f"ref_{dimension}", row.id, None, _valeur(dimension, row))
    db.commit()
    return _valeur(dimension, row)


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
    type_site: str | None = None


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
    if body.type_site is not None and (dimension != "site" or body.type_site not in TYPES_SITE):
        raise HTTPException(422, "Type de site invalide")
    avant = {"libelle": row.libelle, "actif": row.actif}
    if dimension == "site":
        avant["type_site"] = row.type_site
    ancien = row.libelle
    nouveau = body.libelle.strip() if body.libelle is not None else ancien
    renomme = nouveau != ancien
    if renomme:
        if not nouveau:
            raise HTTPException(422, "Libellé vide")
        if dimension == "rubrique" and ancien in {ABSENCES, COMMISSION, *PRIMES}:
            raise HTTPException(409, "Rubrique utilisée par le moteur KPI : renommage interdit")
        if dimension == "rubrique" and any(ancien in rs for rs in COLONNES_INDIVIDUEL.values()):
            raise HTTPException(409, "Rubrique affichée dans le reporting individuel : "
                                     "renommage interdit")
        if db.scalar(select(model.id).where(model.libelle == nouveau, model.id != rid)):
            raise HTTPException(409, "Libellé déjà utilisé")
        pris = db.scalar(select(RefAlias).where(
            RefAlias.dimension == dimension, RefAlias.alias_norm == norm(nouveau)))
        if pris is not None and pris.cible_id != rid:
            raise HTTPException(409, "Libellé déjà utilisé comme alias d'une autre valeur")
    regles, portees = [], []
    if renomme and dimension in ("service", "site"):
        regles = list(db.scalars(select(PerimetreRegle).where(
            PerimetreRegle.dimension == dimension, PerimetreRegle.valeur == ancien)))
        # Valeur accordée en direct à un compte : suit le renommage, comme les périmètres.
        portees = list(db.scalars(select(UtilisateurPortee).where(
            UtilisateurPortee.type == dimension, UtilisateurPortee.valeur == ancien)))
    if apercu:
        return {"perimetres_maj": len({r.perimetre_id for r in regles}),
                "comptes_maj": len({x.utilisateur_id for x in portees})}
    if body.actif is not None:
        row.actif = body.actif
    if body.type_site is not None:
        row.type_site = body.type_site
    if renomme:
        row.libelle = nouveau
        for r in [*regles, *portees]:
            r.valeur = nouveau
        if pris is not None:  # l'alias du nouveau libellé pointait déjà ici : devenu inutile
            db.delete(pris)
            db.flush()
        if not db.scalar(select(RefAlias.id).where(
                RefAlias.dimension == dimension, RefAlias.alias_norm == norm(ancien))):
            db.add(RefAlias(dimension=dimension, alias_norm=norm(ancien), cible_id=rid))
    db.flush()
    apres = {"libelle": row.libelle, "actif": row.actif,
             "perimetres_maj": len({r.perimetre_id for r in regles}),
             "comptes_maj": len({x.utilisateur_id for x in portees})}
    if dimension == "site":
        apres["type_site"] = row.type_site
    audit.record(db, p.user_id, "update", f"ref_{dimension}", rid, avant, apres)
    db.commit()
    return {"id": rid, **apres}
