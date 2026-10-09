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
from app.repos.scope import scope_for
from app.security import audit
from app.security.deps import current_principal
from app.security.policy import Principal, authorize, is_allowed

router = APIRouter(prefix="/rapports", tags=["rapports"])
CLES_MARGE = {"ca", "marge", "taux_marge", "marge_ytd", "nb_mois_marge", "nb_mois_ca", "ca_ytd",
              "taux_marge_ytd"}


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
    return {"services": sorted({L.service for L in lignes}),
            "sites": sorted({L.site for L in lignes})}


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


def _mensuel(db, p, annee, mois, service, site, ref_annee=None, ref_mois=None) -> dict:
    authorize(p, "report:read")
    scope = scope_for(db, p)
    cur = ch.filtrer(ch.charger_periode(db, scope, annee, mois), service, site)
    if cur is None or not cur.lignes:
        raise HTTPException(404, "Aucune donnée pour cette période")
    ref = _reference(annee, mois, ref_annee, ref_mois)
    prev = ch.filtrer(ch.charger_periode(db, scope, *ref), service, site)
    res = moteur.mensuel(cur, prev, ch.charger_refs(db), ch.charger_params(db, annee, mois),
                         ch.charger_budgets(db, scope, annee, mois, service, site))
    return _sortie(p, res)


@router.get("/mensuel")
def mensuel(
    annee: int = Query(ge=2000, le=2100),
    mois: int = Query(ge=1, le=12),
    service: str | None = None,
    site: str | None = None,
    ref_annee: int | None = Query(None, ge=2000, le=2100),
    ref_mois: int | None = Query(None, ge=1, le=12),
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    return _mensuel(db, p, annee, mois, service, site, ref_annee, ref_mois)


@router.get("/mensuel/export")
def mensuel_export(
    annee: int = Query(ge=2000, le=2100),
    mois: int = Query(ge=1, le=12),
    service: str | None = None,
    site: str | None = None,
    ref_annee: int | None = Query(None, ge=2000, le=2100),
    ref_mois: int | None = Query(None, ge=1, le=12),
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    res = _mensuel(db, p, annee, mois, service, site, ref_annee, ref_mois)
    audit.record(db, p.user_id, "export", "rapport_mensuel", f"{annee}-{mois:02d}", None,
                 {"service": service, "site": site})
    db.commit()
    choisie = ref_annee is not None and ref_mois is not None
    prec = f"{xlsx.MOIS[ref_mois - 1]} {ref_annee}" if choisie else "M-1"
    return _xlsx(xlsx.mensuel(res, annee, mois, prec),
                 f"reporting-mensuel-{annee}-{mois:02d}.xlsx")


def _annuel(db, p, annee, mois, service, site, ref_annee=None) -> dict:
    authorize(p, "report:read")
    scope = scope_for(db, p)

    def annee_pds(a: int) -> dict[int, moteur.PeriodeData]:
        out = {}
        for m in range(1, 13):
            pd = ch.filtrer(ch.charger_periode(db, scope, a, m), service, site)
            if pd is not None:
                out[m] = pd
        return out

    n = annee_pds(annee)
    if not moteur.avec_donnees(n):
        raise HTTPException(404, "Aucune donnée pour cette année")
    budgets = {m: ch.charger_budgets(db, scope, annee, m, service, site)
               for m in moteur.avec_donnees(n, mois)}
    res = moteur.annuel(n, annee_pds(ref_annee or annee - 1), mois, ch.charger_refs(db),
                        ch.charger_params(db, annee, mois), budgets)
    return _sortie(p, res)


@router.get("/annuel")
def annuel(
    annee: int = Query(ge=2000, le=2100),
    mois: int = Query(12, ge=1, le=12),
    service: str | None = None,
    site: str | None = None,
    ref_annee: int | None = Query(None, ge=2000, le=2100),
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    return _annuel(db, p, annee, mois, service, site, ref_annee)


@router.get("/annuel/export")
def annuel_export(
    annee: int = Query(ge=2000, le=2100),
    mois: int = Query(12, ge=1, le=12),
    service: str | None = None,
    site: str | None = None,
    ref_annee: int | None = Query(None, ge=2000, le=2100),
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    res = _annuel(db, p, annee, mois, service, site, ref_annee)
    audit.record(db, p.user_id, "export", "rapport_annuel", f"{annee}-{mois:02d}", None,
                 {"service": service, "site": site})
    db.commit()
    return _xlsx(xlsx.annuel(res, annee, mois, ref_annee), f"reporting-annuel-{annee}.xlsx")


@router.get("/individuel/tous")
def individuel_tous(
    annee: int = Query(ge=2000, le=2100),
    matricule: str | None = Query(None, max_length=30),
    service: str | None = Query(None, max_length=100),
    site: str | None = Query(None, max_length=100),
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    """Onglet REPORTING_RH_INDIVIDUEL : par mois, somme des montants de chaque rubrique sur les
    salariés retenus (tous par défaut), effectif concerné par rubrique, total et budget."""
    authorize(p, "nominatif:read")
    scope = scope_for(db, p)
    sal = None
    if matricule:
        sal = db.scalar(select(Salarie).where(Salarie.matricule_norm == norm(matricule)))
        if sal is None:
            raise HTTPException(404, "Matricule introuvable")
    refs = ch.charger_refs(db)
    rubriques = list(refs.rubriques)
    zero = Decimal(0)
    mois = []
    for m in range(1, 13):
        pd = ch.charger_periode(db, scope, annee, m)
        lignes = [] if pd is None else [
            L for L in pd.lignes
            if (sal is None or L.salarie_id == sal.id)
            and (not service or L.service == service) and (not site or L.site == site)]
        if pd is None or not lignes:
            mois.append({"mois": m, "present": False})
            continue
        budget = ch.charger_params(db, annee, m).budget_employe
        mois.append({
            "mois": m, "present": True, "effectif": len(lignes),
            "montants": {r: sum((L.montants.get(r, zero) for L in lignes), zero)
                         for r in rubriques},
            "staff": {r: sum(1 for L in lignes if L.montants.get(r, zero) != 0) for r in rubriques},
            "total": sum((pd.total(L) for L in lignes), zero),
            "budget": None if budget is None else budget * len(lignes),
        })
    if sal is not None and not any(x["present"] for x in mois):
        raise HTTPException(404, "Matricule introuvable")  # hors périmètre : rien ne fuit
    audit.record(db, p.user_id, "lecture_fiche", "salarie", sal.id if sal else None, None,
                 {"annee": annee, "tous": sal is None})
    db.commit()
    return jsonable({"annee": annee, "matricule": sal.matricule if sal else None,
                     "nom": sal.nom if sal else None, "rubriques": rubriques, "mois": mois})


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
