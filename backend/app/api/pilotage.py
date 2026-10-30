"""Pilotage manuel du mois (feuilles RÉSUMÉ et MENSUEL de l'Excel) : budgets, et saisie du CA,
de la marge et de l'activité (OR, devis, factures) à un niveau par mois et par groupe : global,
site, service ou case site x service.

La lecture ne crée jamais de période ; une écriture ouvre le mois s'il ne l'est pas encore.
"""

import re
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.budgets import MODELES, LigneIn, _valeurs, ecrire_budgets, valider_lignes
from app.api.periodes import MARGE_SANS_CA, periode_ou_ouvrir
from app.db.session import get_db
from app.kpi import formules as f
from app.kpi import niveaux as nv
from app.kpi.chargement import exclues_a_date
from app.models.donnees import Periode
from app.models.pilotage import Budget
from app.models.referentiel import Rubrique
from app.repos import saisies
from app.repos.scope import Scope, scope_for
from app.security.deps import current_principal
from app.security.policy import Principal, authorize

router = APIRouter(prefix="/pilotage", tags=["pilotage"])

# Groupes de saisie réservés au droit marge:read (CA et marge, réels ou objectifs).
GROUPES_MARGE = {"ca_marge", "obj_ca_marge"}

# Comptés à l'unité (étude Q4.2) : un objectif de ventes, de clients ou de factures est entier.
_NOMBRES = {"obj_ventes", "obj_clients", "obj_factures"}
OBJECTIF_ENTIER = "Un objectif de ventes, de clients ou de factures est entier"


def _entier(v: Decimal | None) -> bool:
    return v is None or v == v.to_integral_value()


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
    ca, marge = saisies.totaux_ca_marge(db, per.id if per else None)
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


# ---- saisies du mois (CA et marge ; OR, devis et factures) ----
_VALEUR = re.compile(r"\d{1,15}([.,]\d{1,12})?")
_VALEUR_NEGATIVE = re.compile(r"-?\d{1,15}([.,]\d{1,12})?")


def _valeur_activite(s: str | None, negatif: bool = False) -> Decimal | None:
    """Valeur saisie (virgule ou point), exacte, positive ou nulle (négative si `negatif`, pour
    une marge) ; vide = case effacée."""
    if s is None or not s.strip():
        return None
    t = s.strip()
    if not (_VALEUR_NEGATIVE if negatif else _VALEUR).fullmatch(t):
        raise HTTPException(422, "Valeur invalide")
    v = Decimal(t.replace(",", "."))
    return v if v else Decimal(0)  # « -0 » enregistré 0


def _txt_opt(v: Decimal | None) -> str | None:
    return None if v is None else format(v, "f")


def _libelle_permis(scope: Scope, dim: str, lib: str) -> bool:
    if scope.unrestricted:
        return True
    return bool(scope.rules) and (dim not in scope.rules or lib in scope.rules[dim])


def _taux_txt(ca: Decimal | None, marge: Decimal | None) -> str | None:
    taux = f.taux_marge(ca, marge)
    return taux if isinstance(taux, str) or taux is None else str(taux)


def _vue_saisies(db: Session, scope: Scope, groupe: str, annee: int, mois: int,
                 niveau: str | None = None) -> dict:
    """`niveau` : niveau à afficher (par défaut celui en base, sinon celui du dernier mois saisi,
    sinon celui des employés). Si l'affiché diffère de celui en base, chaque case porte
    `propose` (anciennes valeurs d'un niveau plus fin, additionnées) ; ce qui ne se range pas
    dans une case est dans `a_repartir`."""
    pid = saisies.periode_id(db, annee, mois)
    ctx = saisies.contexte(db, pid)

    def vu(c: nv.CaseResolue) -> bool:
        return saisies.case_visible(ctx, scope, c.site_id, c.service_id)

    en_base, defaut = saisies.niveau_groupe(ctx, groupe)
    enregistre = None if defaut else en_base
    if niveau is None:
        niveau = enregistre or saisies.niveau_precedent(db, annee, mois, groupe) or en_base
    res = saisies.resolution(ctx, groupe, niveau)
    cases = [c for c in res.cases if vu(c)]
    inds = nv.GROUPES[groupe]
    totaux = nv.totaliser(cases, inds)
    proposes: dict[nv.Cle, dict[str, Decimal]] = {}
    a_repartir: dict[str, Decimal] = {}
    if enregistre is not None and enregistre != niveau:
        source = [c for c in saisies.resolution(ctx, groupe, enregistre).cases if vu(c)]
        if nv.plus_fin(enregistre, niveau):
            proposes = nv.projeter(source, niveau, inds)
            cibles = {c.cle for c in cases}
            for k in [k for k in proposes if k not in cibles]:
                for ind, v in proposes.pop(k).items():
                    a_repartir[ind] = a_repartir.get(ind, Decimal(0)) + v
        else:
            for ind, t in nv.totaliser(source, inds).items():
                if t.valeur is not None and any(c.valeurs[ind].origine == "saisi" for c in source):
                    a_repartir[ind] = t.valeur
        for ind in nv.MOYENNE:  # une moyenne ne se répartit pas : pas de reste à répartir
            a_repartir.pop(ind, None)
    vus_sites = {c.site_id for c in cases}
    vus_services = {c.service_id for c in cases}
    out = {
        "annee": annee, "mois": mois, "groupe": groupe, "periode_id": pid,
        "indicateurs": list(inds), "niveau": niveau, "niveau_par_defaut": defaut,
        "niveau_enregistre": enregistre,
        "sites": [{"id": i, "libelle": r.libelle} for i, r in ctx.sites.items()
                  if (r.actif or i in vus_sites) and _libelle_permis(scope, "site", r.libelle)],
        "services": [{"id": i, "libelle": r.libelle, "productif": r.productif}
                     for i, r in ctx.services.items()
                     if (r.actif or i in vus_services)
                     and _libelle_permis(scope, "service", r.libelle)],
        "cases": [{"site_id": c.site_id, "service_id": c.service_id,
                   "valeurs": {i: {"saisi": _txt_opt(v.saisi), "employes": _txt_opt(v.employes),
                                   "valeur": _txt_opt(v.valeur), "origine": v.origine,
                                   "ecart": _txt_opt(v.ecart),
                                   "propose": _txt_opt(proposes.get(c.cle, {}).get(i))}
                               for i, v in c.valeurs.items()}}
                  for c in cases],
        "totaux": {i: {"valeur": _txt_opt(t.valeur), "partiel": t.partiel,
                       "renseignes": t.renseignes, "attendus": t.attendus}
                   for i, t in totaux.items()},
        "a_repartir": {i: format(v, "f") for i, v in a_repartir.items()},
    }
    if groupe == "ca_marge":
        out["taux_marge"] = _taux_txt(totaux["ca"].valeur, totaux["marge"].valeur)
        for c, sortie in zip(cases, out["cases"], strict=True):
            sortie["taux_marge"] = _taux_txt(c.valeurs["ca"].valeur, c.valeurs["marge"].valeur)
    return out


@router.get("/saisies")
def lire_saisies(
    groupe: Literal["ca_marge", "activite", "obj_ca_marge", "obj_activite"],
    annee: int = Query(ge=2000, le=2100), mois: int = Query(ge=1, le=12),
    niveau: Literal["global", "site", "service", "cellule"] | None = None,
    p: Principal = Depends(current_principal), db: Session = Depends(get_db),
):
    authorize(p, "import:read")
    if groupe in GROUPES_MARGE:
        authorize(p, "marge:read")
    return _vue_saisies(db, scope_for(db, p), groupe, annee, mois, niveau)


class CaseIn(BaseModel):
    site_id: int | None = None
    service_id: int | None = None
    valeurs: dict[str, str | None]


class SaisiesIn(Mois):
    groupe: str
    niveau: str
    cases: list[CaseIn] = Field(max_length=5000)


def _valider_saisies(ctx: saisies.Contexte, body: SaisiesIn) -> dict[nv.Cle, dict]:
    """Contrôle toutes les cases avant toute écriture : clé de case -> {indicateur: valeur ou
    None si effacée}."""
    if body.niveau not in nv.NIVEAUX:
        raise HTTPException(422, "Niveau inconnu")
    inds = nv.GROUPES[body.groupe]
    cles = [(c.site_id, c.service_id) for c in body.cases]
    if len(set(cles)) != len(cles):
        raise HTTPException(422, "Case en double")
    existant = {c.cle: c for c in saisies.resolution(ctx, body.groupe, body.niveau).cases}
    out: dict[nv.Cle, dict] = {}
    for c in body.cases:
        cle = (c.site_id, c.service_id)
        if nv.niveau_de(*cle) != body.niveau:
            raise HTTPException(422, "Case incohérente avec le niveau de saisie")
        if (c.site_id is not None and c.site_id not in ctx.sites) or (
                c.service_id is not None and c.service_id not in ctx.services):
            raise HTTPException(422, "Site ou service inconnu")
        if any(i not in inds for i in c.valeurs):
            raise HTTPException(422, "Indicateur inconnu")
        vals = {i: _valeur_activite(v, negatif=(i in ("marge", "obj_marge")))
                for i, v in c.valeurs.items()}
        if any(i in _NOMBRES and not _entier(v) for i, v in vals.items()):
            raise HTTPException(422, OBJECTIF_ENTIER)
        marge = vals["marge"] if "marge" in vals else ctx.lignes.get(("marge", *cle))
        if body.groupe == "ca_marge" and marge is not None:
            # CA de la même case : celui envoyé, sinon celui déjà saisi, sinon celui des employés
            ca = vals["ca"] if "ca" in vals else ctx.lignes.get(("ca", *cle))
            if ca is None and cle in existant:
                ca = existant[cle].valeurs["ca"].employes
            if ca is None:
                raise HTTPException(422, MARGE_SANS_CA)
        out[cle] = vals
    return out


def _verifier_perimetre(ctx: saisies.Contexte, scope: Scope, groupe: str, niveau: str,
                        valides: dict[nv.Cle, dict]) -> None:
    """403 si une case sort du périmètre ; changer de niveau ou saisir au niveau global exige un
    périmètre non restreint (avant toute écriture)."""
    if scope.unrestricted:
        return
    inds = nv.GROUPES[groupe]
    actuel = nv.niveau_des_lignes([(si, se) for (i, si, se) in ctx.lignes if i in inds])
    if niveau == "global" or (actuel is not None and actuel != niveau):
        raise HTTPException(403, "Accès refusé")
    if any(not saisies.case_visible(ctx, scope, si, se) for si, se in valides):
        raise HTTPException(403, "Accès refusé")


@router.put("/saisies")
def saisir_saisies(
    body: SaisiesIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db),
):
    authorize(p, "saisie:write")
    if body.groupe not in nv.GROUPES:
        raise HTTPException(422, "Groupe inconnu")
    if body.groupe in GROUPES_MARGE:
        authorize(p, "marge:read")
    scope = scope_for(db, p)
    ctx = saisies.contexte(db, saisies.periode_id(db, body.annee, body.mois))
    valides = _valider_saisies(ctx, body)  # 422 avant toute ouverture du mois
    _verifier_perimetre(ctx, scope, body.groupe, body.niveau, valides)
    if ctx.periode_id is None and all(v is None for vals in valides.values()
                                      for v in vals.values()):
        return _vue_saisies(db, scope, body.groupe, body.annee, body.mois)
    per = periode_ou_ouvrir(db, p, body.annee, body.mois)
    saisies.ecrire(db, p.user_id, per.id, body.groupe, body.niveau, valides)
    db.commit()
    return _vue_saisies(db, scope, body.groupe, body.annee, body.mois)


# ---- objectif annuel réparti sur les 12 mois ----
class TotalAnnuelIn(BaseModel):
    site_id: int | None = None
    service_id: int | None = None
    indicateur: str
    total: str | None = None


class AnneeIn(BaseModel):
    annee: int = Field(ge=2000, le=2100)
    groupe: Literal["obj_ca_marge", "obj_activite"]
    niveau: Literal["global", "site", "service", "cellule"]
    cases: list[TotalAnnuelIn] = Field(max_length=5000)




def repartir_annee(total: Decimal, moyenne: bool) -> list[Decimal]:
    """12 valeurs mensuelles d'un total annuel, exactes à la précision du total saisi : le reste
    de la division va sur décembre. Une moyenne (productivité) vaut la même valeur chaque mois."""
    if moyenne:
        return [total] * 12
    signe, chiffres, exposant = total.as_tuple()
    unites = int("".join(map(str, chiffres)))
    q, r = divmod(unites, 12)
    unite = Decimal((0, (1,), exposant))
    mois = [Decimal(q) * unite] * 11 + [Decimal(q + r) * unite]
    return [-m if signe else m for m in mois]


@router.put("/saisies/annee")
def repartir_objectif_annuel(
    body: AnneeIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db),
):
    """Répartit des objectifs annuels en 12 mois (même écriture que la saisie mensuelle, une trace
    d'audit par mois). Les mois déjà saisis sont écrasés et listés dans `ecrases`."""
    authorize(p, "saisie:write")
    if body.groupe in GROUPES_MARGE:
        authorize(p, "marge:read")
    inds = nv.GROUPES[body.groupe]
    totaux: dict[nv.Cle, dict[str, Decimal]] = {}
    for c in body.cases:
        if c.indicateur not in inds:
            raise HTTPException(422, "Indicateur inconnu")
        t = _valeur_activite(c.total, negatif=(c.indicateur == "obj_marge"))
        if c.indicateur in _NOMBRES and not _entier(t):
            raise HTTPException(422, OBJECTIF_ENTIER)
        cle = (c.site_id, c.service_id)
        if c.indicateur in totaux.get(cle, {}):
            raise HTTPException(422, "Case en double")
        if t is not None:  # total vide = rien à répartir pour cette case
            totaux.setdefault(cle, {})[c.indicateur] = t
    scope = scope_for(db, p)
    mensuels = {cle: {i: repartir_annee(t, i in nv.MOYENNE) for i, t in vals.items()}
                for cle, vals in totaux.items()}
    contextes, ecrases = {}, []
    for m in range(1, 13):  # tout est contrôlé avant la moindre écriture
        ctx = saisies.contexte(db, saisies.periode_id(db, body.annee, m))
        corps = SaisiesIn(annee=body.annee, mois=m, groupe=body.groupe, niveau=body.niveau, cases=[
            CaseIn(site_id=cle[0], service_id=cle[1],
                   valeurs={i: format(v[m - 1], "f") for i, v in vals.items()})
            for cle, vals in mensuels.items()])
        valides = _valider_saisies(ctx, corps)
        _verifier_perimetre(ctx, scope, body.groupe, body.niveau, valides)
        contextes[m] = (ctx, valides)
        autre_niveau = nv.niveau_des_lignes(
            [(si, se) for (i, si, se) in ctx.lignes if i in nv.GROUPES[body.groupe]])
        if (autre_niveau is not None and autre_niveau != body.niveau) or any(
                ctx.lignes.get((i, *cle)) is not None for cle, vals in valides.items()
                for i in vals):
            ecrases.append(m)  # cases remplacées, ou lignes d'un autre niveau effacées
    if not mensuels:
        return {"annee": body.annee, "groupe": body.groupe, "niveau": body.niveau, "mois": [],
                "ecrases": []}
    if any(ctx.periode_id is None for ctx, _v in contextes.values()):
        authorize(p, "periode:write")  # même droit que l'ouverture d'un mois
    ecrits = []
    for m, (_ctx, valides) in contextes.items():
        per = periode_ou_ouvrir(db, p, body.annee, m)
        saisies.ecrire(db, p.user_id, per.id, body.groupe, body.niveau, valides)
        ecrits.append({"mois": m, "cases": [
            {"site_id": cle[0], "service_id": cle[1],
             "valeurs": {i: _txt_opt(v) for i, v in vals.items()}}
            for cle, vals in valides.items()]})
    db.commit()
    return {"annee": body.annee, "groupe": body.groupe, "niveau": body.niveau, "mois": ecrits,
            "ecrases": ecrases}
