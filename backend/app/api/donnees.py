import hashlib
import json
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.imports import modeles, service
from app.imports.lecture import Feuille
from app.imports.regles import ATTRIBUTS, BLOQUANT, MOIS, est_sans_matricule, nombre, valider
from app.kpi.chargement import (
    charger_refs,
    charger_tableau,
    exclues_a_date,
    options_tableau,
    rubriques_exclues,
)
from app.kpi.moteur import exclusions_ligne, total_ligne
from app.models.donnees import Montant, Periode, Salarie, SituationMensuelle
from app.models.imports import ImportAnomalie, LotImport
from app.models.referentiel import Activite, Poste, Rubrique, Service, Site, TypeContrat
from app.repos.scope import scope_for
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
            "total": str(total_ligne(m, exclues)),
        })
    return out


@router.get("")
def donnees_du_mois(annee: int = Query(ge=2000, le=2100), mois: int = Query(ge=1, le=12),
                    p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    authorize(p, "saisie:write")
    return {"annee": annee, "mois": mois,
            "rubriques": [{"libelle": r.libelle, "unite": r.unite} for r in _rubriques(db)],
            "lignes": _lignes(db, annee, mois)}


@router.get("/structure")
def structure(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    """Colonnes et listes de filtres de la feuille DONNEES, sans les lignes : l'écran pose
    l'en-tête complet avant que les lignes n'arrivent."""
    authorize(p, "saisie:write")
    colonnes = list(charger_refs(db).rubriques)
    exclues = rubriques_exclues(db)
    return {"colonnes": colonnes, "exclues": [c for c in colonnes if c in exclues],
            "filtres": options_tableau(db, scope_for(db, p))}


@router.get("/tableau")
def tableau(annee: int | None = Query(None, ge=2000, le=2100),
            mois: int | None = Query(None, ge=1, le=12),
            service: str | None = Query(None, max_length=100),
            site: str | None = Query(None, max_length=100),
            q: str | None = Query(None, max_length=100),
            matricule: str | None = Query(None, max_length=50),
            p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    """Feuille DONNEES : une ligne par employé et par mois, dans le périmètre du demandeur."""
    authorize(p, "saisie:write")
    scope = scope_for(db, p)
    colonnes = list(charger_refs(db).rubriques)
    exclues = rubriques_exclues(db)
    return {"colonnes": colonnes,
            "exclues": [c for c in colonnes if c in exclues],
            "filtres": options_tableau(db, scope),
            "lignes": charger_tableau(db, scope, annee=annee, mois=mois, service=service,
                                      site=site, recherche=q, matricule=matricule)}


@router.get("/modele.xlsx")
def modele_mensuel(annee: int = Query(ge=2000, le=2100), mois: int = Query(ge=1, le=12),
                   matricules: list[str] | None = Query(None),
                   p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    authorize(p, "saisie:write")
    rubriques = [r.libelle for r in _rubriques(db)]
    refs = {k: sorted(_libelles(db, m).values()) for k, m in REFS.items()}
    existantes = {x["matricule"]: x for x in _lignes(db, annee, mois)}
    fiche = [(m, c, _libelles(db, m)) for m, c in (
        (Poste, "poste_id"), (TypeContrat, "type_contrat_id"), (Activite, "activite_id"),
        (Site, "site_id"), (Service, "service_id"))]
    lignes = []
    q = select(Salarie).order_by(Salarie.matricule)
    if matricules:  # employés cochés dans l'assistant de saisie
        q = q.where(Salarie.matricule_norm.in_({m.strip().casefold() for m in matricules}))
    else:
        q = q.where(Salarie.actif)
    for sal in db.scalars(q):
        e = existantes.get(sal.matricule)
        if e:
            attrs = [e["poste"], e["type_contrat"], e["activite"], e["site"], e["service"]]
            vals = [Decimal(e["montants"][r]) if r in e["montants"] else None for r in rubriques]
        else:
            attrs = [lib.get(getattr(sal, c)) for _m, c, lib in fiche]
            vals = [None] * len(rubriques)
        mat = "" if est_sans_matricule(sal.matricule) else sal.matricule
        lignes.append([mat, sal.nom, *attrs, *vals])
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


# ---- Assistant de saisie : préparation, vérification sans écriture, création d'un lot


class LigneSaisie(BaseModel):
    matricule: str = ""
    nom: str | None = None
    poste: str | None = None
    type_contrat: str | None = None
    activite: str | None = None
    site: str | None = None
    service: str | None = None
    montants: dict[str, str | None] = {}


class SaisieIn(BaseModel):
    annee: int = Field(ge=2000, le=2100)
    mois: int = Field(ge=1, le=12)
    lignes: list[LigneSaisie] = Field(max_length=2000)


class LotSaisieIn(SaisieIn):
    brouillon_id: str = Field(min_length=8, max_length=64)


ATTRS_SAISIE = (("poste", "Poste", "poste_id"), ("type_contrat", "Type Contrat", "type_contrat_id"),
                ("activite", "Activité", "activite_id"), ("site", "Site", "site_id"),
                ("service", "Service", "service_id"))


def _montant(v: str | None):
    """La grille ne saisit que du texte : un nombre valide n'y est pas un « texte converti »."""
    if not v:
        return None
    res = nombre(v)
    return res[0] if res else v


def _feuille(annee: int, mois: int, lignes: list[LigneSaisie], rubriques: list[str]) -> Feuille:
    """Grille -> feuille au format de l'import ; la ligne n de la grille porte le numéro n."""
    return Feuille(entete_ligne=0, entetes=[*ATTRIBUTS, *rubriques], lignes=[(i, (
        annee, MOIS[mois - 1], x.matricule.strip() or None, x.nom, x.poste, x.type_contrat,
        x.activite, x.site, x.service, *[_montant(x.montants.get(r)) for r in rubriques]))
        for i, x in enumerate(lignes, start=1)])


@router.post("/modele.xlsx")
def modele_saisie(corps: SaisieIn, p: Principal = Depends(current_principal),
                  db: Session = Depends(get_db)):
    """Modèle xlsx tiré de l'assistant : exactement les lignes envoyées (employés cochés, valeurs
    déjà saisies dans la grille). Aucune ligne : modèle vide, en-tête et listes déroulantes."""
    authorize(p, "saisie:write")
    rubriques = [r.libelle for r in _rubriques(db)]
    refs = {k: sorted(_libelles(db, m).values()) for k, m in REFS.items()}
    lignes = [["" if est_sans_matricule(x.matricule) else x.matricule.strip(), x.nom,
               x.poste, x.type_contrat, x.activite, x.site, x.service,
               *[_montant(x.montants.get(r)) for r in rubriques]] for x in corps.lignes]
    annee, mois = corps.annee, corps.mois
    contenu = modeles.modele_mensuel(annee, mois, rubriques, refs, lignes)
    return Response(contenu, media_type=XLSX, headers={
        "Content-Disposition": f'attachment; filename="donnees_{annee}_{mois:02d}.xlsx"'})


@router.get("/derniere-periode")
def derniere_periode(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    """Dernier mois saisi et son nombre de lignes : l'assistant propose le mois suivant."""
    authorize(p, "saisie:write")
    row = db.execute(select(Periode.annee, Periode.mois, func.count(SituationMensuelle.id))
                     .join(SituationMensuelle, SituationMensuelle.periode_id == Periode.id)
                     .group_by(Periode.annee, Periode.mois)
                     .order_by(Periode.annee.desc(), Periode.mois.desc()).limit(1)).first()
    return None if row is None else {"annee": row[0], "mois": row[1], "lignes": row[2]}


@router.get("/preparation")
def preparation(annee: int = Query(ge=2000, le=2100), mois: int = Query(ge=1, le=12),
                p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    """Employés à renseigner pour un mois : déjà saisi, présent le mois d'avant, attributs."""
    authorize(p, "saisie:write")
    lib = {k: _libelles(db, m) for k, m in REFS.items()}
    saisies = {x["matricule"]: x for x in _lignes(db, annee, mois)}
    pa, pm = (annee, mois - 1) if mois > 1 else (annee - 1, 12)
    precedent = {x["matricule"] for x in _lignes(db, pa, pm)}
    # Dernière situation connue avant le mois : poste, site, service... repris tels quels.
    derniere: dict[int, SituationMensuelle] = {}
    q = (select(SituationMensuelle).join(Periode, Periode.id == SituationMensuelle.periode_id)
         .where((Periode.annee < annee) | ((Periode.annee == annee) & (Periode.mois < mois)))
         .order_by(Periode.annee.desc(), Periode.mois.desc()))
    for sit in db.scalars(q):
        derniere.setdefault(sit.salarie_id, sit)
    salaries = []
    for sal in db.scalars(select(Salarie).order_by(Salarie.nom, Salarie.matricule)):
        e = saisies.get(sal.matricule)
        if not (sal.actif or e):
            continue
        source = derniere.get(sal.id) or sal
        attributs = ({a: e[a] for a, _l, _c in ATTRS_SAISIE} if e else
                     {a: lib[r].get(getattr(source, c)) for a, r, c in ATTRS_SAISIE})
        salaries.append({"matricule": sal.matricule, "nom": sal.nom, "saisi": e is not None,
                         "present_precedent": sal.matricule in precedent, "attributs": attributs,
                         "montants": e["montants"] if e else {}})
    return {"annee": annee, "mois": mois,
            "rubriques": [{"libelle": r.libelle, "unite": r.unite} for r in _rubriques(db)],
            "exclues": sorted(exclues_a_date(db, annee, mois)),
            "referentiels": {a: sorted(lib[r].values()) for a, r, _c in ATTRS_SAISIE},
            "salaries": salaries}


@router.post("/verifier")
def verifier(corps: SaisieIn, p: Principal = Depends(current_principal),
             db: Session = Depends(get_db)):
    """Contrôle de la grille sans rien écrire : anomalies par cellule et TOTAL de chaque ligne."""
    authorize(p, "saisie:write")
    rubriques = [r.libelle for r in _rubriques(db)]
    lignes, anos, _stats = valider(_feuille(corps.annee, corps.mois, corps.lignes, rubriques),
                                   service.charger_refs(db))
    exclues = exclues_a_date(db, corps.annee, corps.mois)
    par_num = {L.num: L for L in lignes}
    totaux = []
    for i in range(1, len(corps.lignes) + 1):
        L = par_num.get(i)
        totaux.append(None if L is None else {
            "total": str(total_ligne(L.montants, exclues)),
            "exclusions": str(exclusions_ligne(L.montants, exclues))})
    return {"anomalies": [{"ligne": a.ligne - 1, "colonne": a.colonne, "code": a.code,
                           "gravite": a.gravite, "message": a.message}
                          for a in anos if a.ligne and a.code != "FICHIER_VIDE"],
            "totaux": totaux}


@router.post("/lots", status_code=201)
def creer_lot_saisie(corps: LotSaisieIn, p: Principal = Depends(current_principal),
                     db: Session = Depends(get_db)):
    """Grille -> lot d'import, même chaîne que le fichier (aperçu, validation, annulation).

    Même brouillon et même contenu -> même lot : un double clic ne crée pas de doublon.
    """
    authorize(p, "saisie:write")
    if not corps.lignes:
        raise HTTPException(422, "Aucune ligne à enregistrer")
    contenu = json.dumps(corps.model_dump(), sort_keys=True, ensure_ascii=False).encode()
    sha = hashlib.sha256(contenu).hexdigest()

    def deja() -> dict | None:
        existant = db.scalar(select(LotImport).where(LotImport.sha256 == sha,
                                                     LotImport.statut.in_(("pret", "valide"))))
        if existant is None:
            return None
        if existant.statut == "valide":
            raise HTTPException(409, {"message": "Saisie déjà enregistrée", "lot_id": existant.id})
        return service.lot_dict(existant)

    if (lot_existant := deja()) is not None:
        return lot_existant
    rubriques = [r.libelle for r in _rubriques(db)]
    try:
        lot = service.analyser_feuille(
            db, p.user_id, f"Saisie {MOIS[corps.mois - 1]} {corps.annee}",
            _feuille(corps.annee, corps.mois, corps.lignes, rubriques), sha, len(contenu))
    except IntegrityError:
        # Requête jumelle arrivée entre la recherche et l'insertion (index unique sur sha actif).
        db.rollback()
        if (lot_existant := deja()) is not None:
            return lot_existant
        raise
    return service.lot_dict(lot)
