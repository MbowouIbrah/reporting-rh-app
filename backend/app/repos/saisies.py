"""Accès base des valeurs saisies du mois (CA, marge, OR, devis, factures) et leur résolution.

Un seul niveau de saisie par mois et par groupe (CA et marge ; OR, devis et factures) : global,
site, service ou case site x service. La résolution elle-même est pure (`app.kpi.niveaux`).
"""

from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.kpi import niveaux as nv
from app.kpi.moteur import CA_INDIVIDUEL, MARGE_INDIVIDUELLE
from app.models.donnees import Montant, Periode, SituationMensuelle
from app.models.pilotage import ValeurSaisie
from app.models.referentiel import Rubrique, Service, Site
from app.repos.scope import Scope
from app.security import audit

EMPLOYE = {CA_INDIVIDUEL: "ca", MARGE_INDIVIDUELLE: "marge"}


@dataclass(frozen=True)
class Contexte:
    """Tout ce qu'il faut pour résoudre les deux groupes d'un mois (chargé une seule fois)."""

    periode_id: int | None
    sites: dict[int, Site]
    services: dict[int, Service]
    lignes: dict[tuple[str, int | None, int | None], Decimal]
    employes: list[nv.Employe]


def periode_id(db: Session, annee: int, mois: int) -> int | None:
    return db.scalar(select(Periode.id).where(Periode.annee == annee, Periode.mois == mois))


def _dec(v) -> Decimal:
    """SQLite renvoie des float pour NUMERIC."""
    return Decimal(str(v))


def _employes(db: Session, pid: int) -> list[nv.Employe]:
    sits = db.execute(select(SituationMensuelle.id, SituationMensuelle.site_id,
                             SituationMensuelle.service_id)
                      .where(SituationMensuelle.periode_id == pid)).all()
    if not sits:
        return []
    vals: dict[int, dict[str, Decimal]] = defaultdict(dict)
    q = (select(Montant.situation_id, Rubrique.libelle, Montant.valeur)
         .join(Rubrique, Rubrique.id == Montant.rubrique_id)
         .where(Montant.situation_id.in_(select(SituationMensuelle.id)
                                         .where(SituationMensuelle.periode_id == pid)),
                Rubrique.libelle.in_(tuple(EMPLOYE))))
    for sid, lib, v in db.execute(q):
        vals[sid][EMPLOYE[lib]] = _dec(v)
    return [nv.Employe(si, se, vals.get(sid, {})) for sid, si, se in sits]


def contexte(db: Session, pid: int | None) -> Contexte:
    sites = {r.id: r for r in db.scalars(select(Site).order_by(Site.id))}
    services = {r.id: r for r in db.scalars(select(Service).order_by(Service.id))}
    if pid is None:
        return Contexte(None, sites, services, {}, [])
    lignes = {(r.indicateur, r.site_id, r.service_id): _dec(r.valeur)
              for r in db.scalars(select(ValeurSaisie).where(ValeurSaisie.periode_id == pid))}
    return Contexte(pid, sites, services, lignes, _employes(db, pid))


def niveau_groupe(ctx: Contexte, groupe: str) -> tuple[str, bool]:
    """Niveau en vigueur du groupe (celui des lignes existantes) et s'il est pris par défaut."""
    inds = nv.GROUPES[groupe]
    existant = nv.niveau_des_lignes([(si, se) for (ind, si, se) in ctx.lignes if ind in inds])
    if existant is not None:
        return existant, False
    return nv.niveau_par_defaut(groupe, ctx.employes), True


def resolution(ctx: Contexte, groupe: str, niveau: str | None = None) -> nv.Resolution:
    niveau = niveau or niveau_groupe(ctx, groupe)[0]
    return nv.resoudre(
        groupe, niveau,
        sites=[i for i, r in ctx.sites.items() if r.actif],
        services=[i for i, r in ctx.services.items() if r.actif],
        saisies=ctx.lignes, employes=ctx.employes)


def dans_perimetre(scope: Scope, site: str | None, service: str | None) -> bool:
    """Une case n'est visible que si chaque dimension restreinte y est renseignée et accordée."""
    if scope.unrestricted:
        return True
    if not scope.rules or any(d not in ("site", "service") for d in scope.rules):
        return False
    return all(lib is not None and lib in scope.rules[d]
               for d, lib in (("site", site), ("service", service)) if d in scope.rules)


def case_visible(ctx: Contexte, scope: Scope, site_id: int | None, service_id: int | None) -> bool:
    site, service = ctx.sites.get(site_id), ctx.services.get(service_id)
    return dans_perimetre(scope, site.libelle if site else None,
                          service.libelle if service else None)


def totaux_ca_marge(db: Session, pid: int | None) -> tuple[Decimal | None, Decimal | None]:
    """CA et marge du mois, totaux résolus du groupe (saisie ou, à défaut, somme des employés)."""
    if pid is None:
        return None, None
    t = resolution(contexte(db, pid), "ca_marge").totaux
    return t["ca"].valeur, t["marge"].valeur


def _instantane(db: Session, pid: int, groupe: str) -> dict[str, Decimal]:
    q = select(ValeurSaisie).where(ValeurSaisie.periode_id == pid,
                                   ValeurSaisie.indicateur.in_(nv.GROUPES[groupe]))
    return {f"{r.indicateur}/{r.site_id or ''}/{r.service_id or ''}": _dec(r.valeur)
            for r in db.scalars(q)}


def ecrire(db: Session, user_id: int | None, pid: int, groupe: str, niveau: str,
           valeurs: dict[nv.Cle, dict[str, Decimal | None]]) -> None:
    """Écrit les cases d'un groupe à un niveau (None = case effacée). Les lignes du groupe d'un
    autre niveau sont supprimées (un seul niveau par mois et par groupe). Trace d'audit si
    quelque chose change. Pas de commit."""
    inds = nv.GROUPES[groupe]
    avant = _instantane(db, pid, groupe)
    existantes = {(r.indicateur, r.site_id, r.service_id): r for r in db.scalars(
        select(ValeurSaisie).where(ValeurSaisie.periode_id == pid,
                                   ValeurSaisie.indicateur.in_(inds)))}
    niveau_avant = nv.niveau_des_lignes([(si, se) for _i, si, se in existantes])
    for (ind, si, se), ligne in list(existantes.items()):
        if nv.niveau_de(si, se) != niveau:
            db.delete(ligne)
            del existantes[(ind, si, se)]
    db.flush()
    for (si, se), vals in valeurs.items():
        for ind, v in vals.items():
            ligne = existantes.get((ind, si, se))
            if v is None:
                if ligne is not None:
                    db.delete(ligne)
            elif ligne is None:
                db.add(ValeurSaisie(periode_id=pid, indicateur=ind, site_id=si, service_id=se,
                                    valeur=v))
            else:
                ligne.valeur = v
    db.flush()
    apres = _instantane(db, pid, groupe)
    if apres != avant:  # comparaison numérique : 7 et 7.000 sont la même valeur
        def txt(d):  # au moins 3 décimales, comme les montants relus
            def t(v):
                v = v.normalize()
                if v.as_tuple().exponent > -3:
                    v = v.quantize(Decimal("0.001"))
                return format(v, "f")
            return {k: t(v) for k, v in d.items()}
        audit.record(db, user_id, "saisie_pilotage", "periode", pid,
                     {"groupe": groupe, "niveau": niveau_avant, "valeurs": txt(avant)},
                     {"groupe": groupe, "niveau": niveau, "valeurs": txt(apres)})
