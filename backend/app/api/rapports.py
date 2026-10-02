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
CLES_MARGE = {"ca", "marge", "taux_marge", "marge_ytd", "nb_mois_marge"}


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
            out.append({"annee": per.annee, "mois": per.mois, "statut": per.statut})
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


def _mensuel(db, p, annee, mois, service, site) -> dict:
    authorize(p, "report:read")
    scope = scope_for(db, p)
    cur = ch.filtrer(ch.charger_periode(db, scope, annee, mois), service, site)
    if cur is None or not cur.lignes:
        raise HTTPException(404, "Aucune donnée pour cette période")
    prev = ch.filtrer(ch.charger_periode(db, scope, *ch.precedente(annee, mois)), service, site)
    res = moteur.mensuel(cur, prev, ch.charger_refs(db), ch.charger_params(db, annee, mois),
                         ch.charger_budgets(db, scope, annee, mois, service, site))
    return _sortie(p, res)


@router.get("/mensuel")
def mensuel(
    annee: int = Query(ge=2000, le=2100),
    mois: int = Query(ge=1, le=12),
    service: str | None = None,
    site: str | None = None,
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    return _mensuel(db, p, annee, mois, service, site)


@router.get("/mensuel/export")
def mensuel_export(
    annee: int = Query(ge=2000, le=2100),
    mois: int = Query(ge=1, le=12),
    service: str | None = None,
    site: str | None = None,
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    res = _mensuel(db, p, annee, mois, service, site)
    audit.record(db, p.user_id, "export", "rapport_mensuel", f"{annee}-{mois:02d}", None,
                 {"service": service, "site": site})
    db.commit()
    return _xlsx(xlsx.mensuel(res, annee, mois), f"reporting-mensuel-{annee}-{mois:02d}.xlsx")


def _annuel(db, p, annee, mois, service, site) -> dict:
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
    res = moteur.annuel(n, annee_pds(annee - 1), mois, ch.charger_refs(db),
                        ch.charger_params(db, annee, mois))
    return _sortie(p, res)


@router.get("/annuel")
def annuel(
    annee: int = Query(ge=2000, le=2100),
    mois: int = Query(12, ge=1, le=12),
    service: str | None = None,
    site: str | None = None,
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    return _annuel(db, p, annee, mois, service, site)


@router.get("/annuel/export")
def annuel_export(
    annee: int = Query(ge=2000, le=2100),
    mois: int = Query(12, ge=1, le=12),
    service: str | None = None,
    site: str | None = None,
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    res = _annuel(db, p, annee, mois, service, site)
    audit.record(db, p.user_id, "export", "rapport_annuel", f"{annee}-{mois:02d}", None,
                 {"service": service, "site": site})
    db.commit()
    return _xlsx(xlsx.annuel(res, annee, mois), f"reporting-annuel-{annee}.xlsx")


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
