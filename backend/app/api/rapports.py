from dataclasses import replace
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.exports import xlsx
from app.imports.regles import norm
from app.kpi import chargement as ch
from app.kpi import moteur
from app.models.donnees import Periode, Salarie
from app.models.referentiel import Rubrique
from app.repos.scope import scope_for
from app.security import audit
from app.security.deps import current_principal
from app.security.policy import Principal, authorize, is_allowed

router = APIRouter(prefix="/rapports", tags=["rapports"])
CLES_MARGE = {"ca", "marge", "taux_marge", "marge_ytd", "nb_mois_marge", "nb_mois_ca", "ca_ytd",
              "taux_marge_ytd", "ca_cumul", "ca_par_effectif"}

# Colonnes du reporting individuel (RETOURS_PRESENTATION §4, docs/QUESTIONS_CLIENT.md A3, B1,
# B2) et les rubriques de DONNEES qu'elles reprennent, une par colonne : « Autres primes » = primes
# sur ventes et sur résultats, chacune dans sa colonne. « Primes exceptionnelles » = hors salaire.
COLONNES_INDIVIDUEL: dict[str, tuple[str, ...]] = {
    "Salaire brut garanti": ("Salaire brut garantie",),
    "Commission": ("Commission",),
    "Primes de productivité": ("Productivité Ateliers",),
    "Brut réel": ("Brut Réel",),
    "Bonus": ("Bonus",),
    "Primes sur ventes": ("Primes sur ventes",),
    "Primes sur résultats": ("Primes sur résultats",),
    "Marge MAD + TVA": ("TVA & Marge MAD",),
    "Crédit téléphonique": ("Crédit téléphonique",),
    "Frais de mission": ("Frais de mission",),
    "Primes exceptionnelles": ("Primes exceptionnelles",),
    "Logement site déporté": ("Logement site déporté",),
    "Carburant véhicule service": ("Carburant véhicule service",),
}


XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _xlsx(contenu: bytes, nom: str) -> Response:
    return Response(contenu, media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="{nom}"'})


def jsonable(x):
    """Decimal -> chaîne exacte : aucun passage par float."""
    if isinstance(x, Decimal):
        return str(x)
    if isinstance(x, dict):
        return {k: jsonable(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [jsonable(v) for v in x]
    return x


def _sans_marge(x):
    if isinstance(x, dict):
        return {k: _sans_marge(v) for k, v in x.items() if k not in CLES_MARGE}
    if isinstance(x, list):
        return [_sans_marge(v) for v in x]
    return x


def _sortie(p: Principal, data: dict) -> dict:
    return jsonable(data if is_allowed(p, "marge:read") else _sans_marge(data))


@router.get("/periodes")
def periodes(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    authorize(p, "report:read")
    scope = scope_for(db, p)
    out = []
    for per in db.scalars(select(Periode).order_by(Periode.annee, Periode.mois)):
        pd = ch.charger_periode(db, scope, per.annee, per.mois)
        if pd is not None and pd.lignes:
            out.append({"annee": per.annee, "mois": per.mois})
    return out


def _lignes_annee(db: Session, p: Principal, annee: int):
    scope = scope_for(db, p)
    for m in range(1, 13):
        pd = ch.charger_periode(db, scope, annee, m)
        if pd is not None:
            yield from pd.lignes


@router.get("/filtres")
def filtres(
    annee: int = Query(ge=2000, le=2100),
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    authorize(p, "report:read")
    lignes = list(_lignes_annee(db, p, annee))
    # Combinaisons présentes : le front n'offre, pour chaque filtre, que les valeurs compatibles
    # avec les autres filtres choisis (jamais d'option qui mène à un résultat vide).
    combinaisons = sorted(
        {(L.service, L.site, L.type_site, L.activite or "", L.contrat, L.poste or "")
         for L in lignes}
    )
    return {"combinaisons": [list(c) for c in combinaisons],
            "services": sorted({L.service for L in lignes}),
            "sites": sorted({L.site for L in lignes}),
            "types_site": sorted({L.type_site for L in lignes}),
            "type_par_site": {L.site: L.type_site for L in lignes},
            "postes": sorted({L.poste for L in lignes if L.poste}),
            "activites": sorted({L.activite for L in lignes if L.activite}),
            "types_contrat": sorted({L.contrat for L in lignes})}


@router.get("/salaries")
def salaries(
    annee: int = Query(ge=2000, le=2100),
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    authorize(p, "nominatif:read")
    ids = {L.salarie_id for L in _lignes_annee(db, p, annee)}
    rows = db.scalars(select(Salarie).where(Salarie.id.in_(ids))) if ids else []
    return sorted(({"matricule": r.matricule, "nom": r.nom} for r in rows),
                  key=lambda x: x["matricule"])


def _reference(annee, mois, ref_annee, ref_mois) -> tuple[int, int]:
    """Période de comparaison du mensuel : celle choisie, sinon le mois précédent."""
    if ref_annee is None or ref_mois is None:
        return ch.precedente(annee, mois)
    return ref_annee, ref_mois


def _salarie_id(db: Session, p: Principal, matricule: str | None) -> int | None:
    """Filtre « employé » des rapports : nominatif, donc soumis au droit de lecture nominative."""
    if not matricule:
        return None
    authorize(p, "nominatif:read")
    sal = db.scalar(select(Salarie).where(Salarie.matricule_norm == norm(matricule)))
    if sal is None:
        raise HTTPException(404, "Matricule introuvable")
    return sal.id


def _mensuel(db, p, annee, mois, service, site, ref_annee=None, ref_mois=None,
             type_site=None, poste=None, matricule=None, activite=None, type_contrat=None) -> dict:
    authorize(p, "report:read")
    scope = scope_for(db, p)
    crit = {"type_site": type_site, "poste": poste, "salarie_id": _salarie_id(db, p, matricule),
            "activite": activite, "type_contrat": type_contrat}
    cur = ch.filtrer(ch.charger_periode(db, scope, annee, mois), service, site, **crit)
    if cur is None or not cur.lignes:
        raise HTTPException(404, "Aucune donnée pour cette période")
    ref = _reference(annee, mois, ref_annee, ref_mois)
    prev = ch.filtrer(ch.charger_periode(db, scope, *ref), service, site, **crit)
    params = ch.charger_params(db, annee, mois)
    if poste or type_contrat or crit["salarie_id"] is not None:
        # pas de budget pour un poste, un type de contrat ou une personne :
        # seulement pour un effectif d'ensemble
        params = replace(params, budget_employe=None)
    res = moteur.mensuel(cur, prev, ch.charger_refs(db, type_site, scope), params,
                         ch.charger_budgets(db, scope, annee, mois, service, site, **crit))
    return _sortie(p, res)


@router.get("/mensuel")
def mensuel(
    annee: int = Query(ge=2000, le=2100),
    mois: int = Query(ge=1, le=12),
    service: str | None = None,
    site: str | None = None,
    ref_annee: int | None = Query(None, ge=2000, le=2100),
    ref_mois: int | None = Query(None, ge=1, le=12),
    type_site: str | None = Query(None, pattern="^(principal|agence|deporte)$"),
    poste: str | None = Query(None, max_length=200),
    matricule: str | None = Query(None, max_length=30),
    activite: str | None = Query(None, max_length=100),
    type_contrat: str | None = Query(None, max_length=100),
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    return _mensuel(db, p, annee, mois, service, site, ref_annee, ref_mois, type_site, poste,
                    matricule, activite, type_contrat)


@router.get("/mensuel/export")
def mensuel_export(
    annee: int = Query(ge=2000, le=2100),
    mois: int = Query(ge=1, le=12),
    service: str | None = None,
    site: str | None = None,
    ref_annee: int | None = Query(None, ge=2000, le=2100),
    ref_mois: int | None = Query(None, ge=1, le=12),
    type_site: str | None = Query(None, pattern="^(principal|agence|deporte)$"),
    poste: str | None = Query(None, max_length=200),
    matricule: str | None = Query(None, max_length=30),
    activite: str | None = Query(None, max_length=100),
    type_contrat: str | None = Query(None, max_length=100),
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    res = _mensuel(db, p, annee, mois, service, site, ref_annee, ref_mois, type_site, poste,
                   matricule, activite, type_contrat)
    audit.record(db, p.user_id, "export", "rapport_mensuel", f"{annee}-{mois:02d}", None,
                 {"service": service, "site": site, "type_site": type_site, "poste": poste,
                  "matricule": matricule, "activite": activite,
                  "type_contrat": type_contrat})
    db.commit()
    if ref_annee is None or ref_mois is None:
        ref_annee, ref_mois = (annee - 1, 12) if mois == 1 else (annee, mois - 1)
    prec = f"{xlsx.MOIS[ref_mois - 1]} {ref_annee}"
    return _xlsx(xlsx.mensuel(res, annee, mois, prec),
                 f"reporting-mensuel-{annee}-{mois:02d}.xlsx")


def _annuel(db, p, annee, mois, service, site, ref_annee=None, type_site=None, poste=None,
            matricule=None, activite=None, type_contrat=None) -> dict:
    authorize(p, "report:read")
    scope = scope_for(db, p)
    crit = {"type_site": type_site, "poste": poste, "salarie_id": _salarie_id(db, p, matricule),
            "activite": activite, "type_contrat": type_contrat}

    def annee_pds(a: int) -> dict[int, moteur.PeriodeData]:
        out = {}
        for m in range(1, 13):
            pd = ch.filtrer(ch.charger_periode(db, scope, a, m), service, site, **crit)
            if pd is not None:
                out[m] = pd
        return out

    n = annee_pds(annee)
    if not moteur.avec_donnees(n):
        raise HTTPException(404, "Aucune donnée pour cette année")
    budgets = {m: ch.charger_budgets(db, scope, annee, m, service, site, **crit)
               for m in moteur.avec_donnees(n, mois)}
    refs = ch.charger_refs(db, type_site, scope)
    res = moteur.annuel(n, annee_pds(ref_annee or annee - 1), mois, refs,
                        ch.charger_params(db, annee, mois), budgets)
    return _sortie(p, res)


@router.get("/annuel")
def annuel(
    annee: int = Query(ge=2000, le=2100),
    mois: int = Query(12, ge=1, le=12),
    service: str | None = None,
    site: str | None = None,
    ref_annee: int | None = Query(None, ge=2000, le=2100),
    type_site: str | None = Query(None, pattern="^(principal|agence|deporte)$"),
    poste: str | None = Query(None, max_length=200),
    matricule: str | None = Query(None, max_length=30),
    activite: str | None = Query(None, max_length=100),
    type_contrat: str | None = Query(None, max_length=100),
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    return _annuel(db, p, annee, mois, service, site, ref_annee, type_site, poste, matricule,
                   activite, type_contrat)


@router.get("/annuel/export")
def annuel_export(
    annee: int = Query(ge=2000, le=2100),
    mois: int = Query(12, ge=1, le=12),
    service: str | None = None,
    site: str | None = None,
    ref_annee: int | None = Query(None, ge=2000, le=2100),
    type_site: str | None = Query(None, pattern="^(principal|agence|deporte)$"),
    poste: str | None = Query(None, max_length=200),
    matricule: str | None = Query(None, max_length=30),
    activite: str | None = Query(None, max_length=100),
    type_contrat: str | None = Query(None, max_length=100),
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    res = _annuel(db, p, annee, mois, service, site, ref_annee, type_site, poste, matricule,
                   activite, type_contrat)
    audit.record(db, p.user_id, "export", "rapport_annuel", f"{annee}-{mois:02d}", None,
                 {"service": service, "site": site, "type_site": type_site, "poste": poste,
                  "matricule": matricule, "activite": activite,
                  "type_contrat": type_contrat})
    db.commit()
    return _xlsx(xlsx.annuel(res, annee, mois, ref_annee), f"reporting-annuel-{annee}.xlsx")


@router.get("/individuel/tous")
def individuel_tous(
    annee: int = Query(ge=2000, le=2100),
    matricule: str | None = Query(None, max_length=30),
    service: str | None = Query(None, max_length=100),
    site: str | None = Query(None, max_length=100),
    type_site: str | None = Query(None, pattern="^(principal|agence|deporte)$"),
    poste: str | None = Query(None, max_length=200),
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    """Onglet REPORTING_RH_INDIVIDUEL : par mois, somme des montants de chaque rubrique sur les
    salariés retenus (tous par défaut), effectif concerné par colonne et total.
    Comme dans DONNEES, une colonne dont les rubriques sont exclues du total de ligne est signalée
    (`exclues`) et le TOTAL MENSUEL ne somme que les colonnes comptées à la date du mois.
    `deporte` indique si un site déporté figure dans le mois (logement sinon sans objet)."""
    authorize(p, "nominatif:read")
    scope = scope_for(db, p)
    sal = None
    if matricule:
        sal = db.scalar(select(Salarie).where(Salarie.matricule_norm == norm(matricule)))
        if sal is None:
            raise HTTPException(404, "Matricule introuvable")
    # Ordre global des colonnes (paramétrage, partagé avec DONNEES).
    rang = {lib: o for lib, o in db.execute(select(Rubrique.libelle, Rubrique.ordre))}
    rubriques = sorted(COLONNES_INDIVIDUEL,
                       key=lambda c: min(rang.get(r, 10**6) for r in COLONNES_INDIVIDUEL[c]))
    exclues = ch.rubriques_exclues(db)
    zero = Decimal(0)

    def montant(L, col: str) -> Decimal:
        return sum((L.montants.get(r, zero) for r in COLONNES_INDIVIDUEL[col]), zero)

    def comptee(pd, col: str) -> bool:
        return not all(r in pd.exclues for r in COLONNES_INDIVIDUEL[col])
    mois = []
    for m in range(1, 13):
        pd = ch.charger_periode(db, scope, annee, m)
        lignes = [] if pd is None else [
            L for L in pd.lignes
            if (sal is None or L.salarie_id == sal.id)
            and (not service or L.service == service) and (not site or L.site == site)
            and (not type_site or L.type_site == type_site) and (not poste or L.poste == poste)]
        if pd is None or not lignes:
            mois.append({"mois": m, "present": False})
            continue
        mois.append({
            "mois": m, "present": True, "effectif": len(lignes),
            "montants": {c: sum((montant(L, c) for L in lignes), zero) for c in rubriques},
            "staff": {c: sum(1 for L in lignes if montant(L, c) != 0) for c in rubriques},
            "total": sum((montant(L, c) for L in lignes for c in rubriques if comptee(pd, c)),
                         zero),
            "deporte": any(L.type_site == "deporte" for L in lignes),
        })
    if sal is not None and not any(x["present"] for x in mois):
        raise HTTPException(404, "Matricule introuvable")  # hors périmètre : rien ne fuit
    audit.record(db, p.user_id, "lecture_fiche", "salarie", sal.id if sal else None, None,
                 {"annee": annee, "tous": sal is None})
    db.commit()
    return jsonable({"annee": annee, "matricule": sal.matricule if sal else None,
                     "nom": sal.nom if sal else None, "rubriques": rubriques,
                     "exclues": [c for c in rubriques
                                 if all(r in exclues for r in COLONNES_INDIVIDUEL[c])],
                     "sources": {c: list(COLONNES_INDIVIDUEL[c]) for c in rubriques},
                     "mois": mois})


@router.get("/individuel")
def individuel(
    annee: int = Query(ge=2000, le=2100),
    matricule: str = Query(min_length=1, max_length=30),
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    authorize(p, "nominatif:read")
    sal = db.scalar(select(Salarie).where(Salarie.matricule_norm == norm(matricule)))
    scope = scope_for(db, p)
    pds = {m: pd for m in range(1, 13)
           if (pd := ch.charger_periode(db, scope, annee, m)) is not None}
    if sal is None or not any(L.salarie_id == sal.id for pd in pds.values() for L in pd.lignes):
        raise HTTPException(404, "Matricule introuvable")
    audit.record(db, p.user_id, "lecture_fiche", "salarie", sal.id, None, {"annee": annee})
    db.commit()
    res = moteur.individuel(pds, sal.id, ch.charger_refs(db))
    return jsonable({"matricule": sal.matricule, "nom": sal.nom, "annee": annee, **res})
