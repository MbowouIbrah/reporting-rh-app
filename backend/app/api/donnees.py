import hashlib
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.imports import modeles, service
from app.imports.lecture import Feuille
from app.imports.regles import ATTRIBUTS, BLOQUANT, MOIS
from app.kpi.chargement import exclues_a_date
from app.models.donnees import Montant, Periode, Salarie, SituationMensuelle
from app.models.imports import ImportAnomalie
from app.models.referentiel import Activite, Poste, Rubrique, Service, Site, TypeContrat
from app.security.deps import current_principal
from app.security.policy import Principal, authorize

router = APIRouter(prefix="/donnees", tags=["donnees"])
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
REFS = {"Poste": Poste, "Type Contrat": TypeContrat, "Activité": Activite, "Site": Site,
        "Service": Service}


def _libelles(db: Session, model) -> dict[int, str]:
    return {r.id: r.libelle for r in db.scalars(select(model))}


def _rubriques(db: Session) -> list[Rubrique]:
    return list(db.scalars(select(Rubrique).where(Rubrique.actif).order_by(Rubrique.ordre)))


def _lignes(db: Session, annee: int, mois: int) -> list[dict]:
    per = db.scalar(select(Periode).where(Periode.annee == annee, Periode.mois == mois))
    if per is None:
        return []
    rub = {r.id: r.libelle for r in db.scalars(select(Rubrique))}
    lib = {k: _libelles(db, m) for k, m in REFS.items()}
    exclues = exclues_a_date(db, annee, mois)
    montants: dict[int, dict[str, Decimal]] = {}
    for sid, rid, v in db.execute(
        select(Montant.situation_id, Montant.rubrique_id, Montant.valeur)
        .join(SituationMensuelle, SituationMensuelle.id == Montant.situation_id)
        .where(SituationMensuelle.periode_id == per.id)
    ):
        montants.setdefault(sid, {})[rub[rid]] = v
    out = []
    q = (select(SituationMensuelle, Salarie)
         .join(Salarie, Salarie.id == SituationMensuelle.salarie_id)
         .where(SituationMensuelle.periode_id == per.id).order_by(Salarie.matricule))
    for sit, sal in db.execute(q):
        m = montants.get(sit.id, {})
        out.append({
            "matricule": sal.matricule, "nom": sal.nom,
            "poste": lib["Poste"].get(sit.poste_id),
            "type_contrat": lib["Type Contrat"][sit.type_contrat_id],
            "activite": lib["Activité"][sit.activite_id], "site": lib["Site"][sit.site_id],
            "service": lib["Service"][sit.service_id],
            "montants": {k: str(v) for k, v in m.items()},
            "total": str(sum((v for k, v in m.items() if k not in exclues), Decimal(0))),
        })
    return out


@router.get("")
def donnees_du_mois(annee: int = Query(ge=2000, le=2100), mois: int = Query(ge=1, le=12),
                    p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    authorize(p, "saisie:write")
    return {"annee": annee, "mois": mois,
            "rubriques": [{"libelle": r.libelle, "unite": r.unite} for r in _rubriques(db)],
            "lignes": _lignes(db, annee, mois)}


@router.get("/modele.xlsx")
def modele_mensuel(annee: int = Query(ge=2000, le=2100), mois: int = Query(ge=1, le=12),
                   p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    authorize(p, "saisie:write")
    rubriques = [r.libelle for r in _rubriques(db)]
    refs = {k: sorted(_libelles(db, m).values()) for k, m in REFS.items()}
    existantes = {x["matricule"]: x for x in _lignes(db, annee, mois)}
    fiche = [(m, c, _libelles(db, m)) for m, c in (
        (Poste, "poste_id"), (TypeContrat, "type_contrat_id"), (Activite, "activite_id"),
        (Site, "site_id"), (Service, "service_id"))]
    lignes = []
    for sal in db.scalars(select(Salarie).where(Salarie.actif).order_by(Salarie.matricule)):
        e = existantes.get(sal.matricule)
        if e:
            attrs = [e["poste"], e["type_contrat"], e["activite"], e["site"], e["service"]]
            vals = [Decimal(e["montants"][r]) if r in e["montants"] else None for r in rubriques]
        else:
            attrs = [lib.get(getattr(sal, c)) for _m, c, lib in fiche]
            vals = [None] * len(rubriques)
        lignes.append([sal.matricule, sal.nom, *attrs, *vals])
    contenu = modeles.modele_mensuel(annee, mois, rubriques, refs, lignes)
    return Response(contenu, media_type=XLSX, headers={
        "Content-Disposition": f'attachment; filename="donnees_{annee}_{mois:02d}.xlsx"'})


class LigneIn(BaseModel):
    annee: int
    mois: int
    matricule: str
    nom: str | None = None
    poste: str | None = None
    type_contrat: str | None = None
    activite: str | None = None
    site: str | None = None
    service: str | None = None
    montants: dict[str, str] = {}


@router.post("/lignes", status_code=201)
def saisir_ligne(f: LigneIn, p: Principal = Depends(current_principal),
                 db: Session = Depends(get_db)):
    """Ajout ou remplacement d'une ligne : même chaîne que l'import (règles, audit, annulation)."""
    authorize(p, "saisie:write")
    if not 1 <= f.mois <= 12:
        raise HTTPException(422, "Mois invalide")
    sal = db.scalar(select(Salarie).where(Salarie.matricule_norm == f.matricule.strip().casefold()))
    nom = f.nom or (sal.nom if sal else None)
    rubriques = [r.libelle for r in _rubriques(db)]
    ligne = [f.annee, MOIS[f.mois - 1], f.matricule.strip(), nom, f.poste, f.type_contrat,
             f.activite, f.site, f.service, *[f.montants.get(r) or None for r in rubriques]]
    feuille = Feuille(entete_ligne=3, entetes=[*ATTRIBUTS, *rubriques], lignes=[(4, tuple(ligne))])
    sha = hashlib.sha256(uuid.uuid4().bytes).hexdigest()
    lot = service.analyser_feuille(db, p.user_id, f"saisie {f.matricule}", feuille, sha, 0)
    if lot.statut != "pret":
        anos = db.scalars(select(ImportAnomalie).where(ImportAnomalie.lot_id == lot.id,
                                                       ImportAnomalie.gravite == BLOQUANT))
        raise HTTPException(422, {"message": "Ligne refusée", "anomalies": [
            {"colonne": a.colonne, "message": a.message} for a in anos]})
    service.valider_lot(db, p.user_id, lot.id)
    return {"lot_id": lot.id}
