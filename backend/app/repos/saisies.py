"""Accès base des valeurs saisies du mois (CA, marge, OR, devis, factures) et leur résolution.

Un seul niveau de saisie par mois et par groupe (CA et marge ; OR, devis et factures) : global,
site, service ou case site x service. La résolution elle-même est pure (`app.kpi.niveaux`).
"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.kpi import niveaux as nv
from app.kpi.moteur import CA_INDIVIDUEL, MARGE_INDIVIDUELLE
from app.models.auth import _now
from app.models.donnees import Montant, Periode, SituationMensuelle
from app.models.pilotage import DateEmployes, ValeurSaisie
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
    dates_saisies: dict[tuple[str, int | None, int | None], datetime] = field(default_factory=dict)
    dates_employes: dict[tuple[str, int | None, int | None], datetime] = field(default_factory=dict)
    tranches: dict[tuple[str, int | None, int | None], datetime] = field(default_factory=dict)


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
    lignes, dates, tranches = {}, {}, {}
    # colonnes et non entités : toutes les dates relues de la base se comparent entre elles
    for ind, si, se, v, d, t in db.execute(
            select(ValeurSaisie.indicateur, ValeurSaisie.site_id, ValeurSaisie.service_id,
                   ValeurSaisie.valeur, ValeurSaisie.modifie_le, ValeurSaisie.tranche_le)
            .where(ValeurSaisie.periode_id == pid)):
        lignes[(ind, si, se)] = _dec(v)
        dates[(ind, si, se)] = d
        if t is not None:
            tranches[(ind, si, se)] = t
    dates_employes = {(ind, si, se): d for ind, si, se, d in db.execute(
        select(DateEmployes.indicateur, DateEmployes.site_id, DateEmployes.service_id,
               DateEmployes.modifie_le).where(DateEmployes.periode_id == pid))}
    return Contexte(pid, sites, services, lignes, _employes(db, pid),
                    dates, dates_employes, tranches)


CleSomme = tuple[int, str, int | None, int | None]


def verrouiller_periodes(db: Session, pids: set[int]) -> None:
    """Une seule écriture à la fois par mois : deux validations, saisies ou choix simultanés ne
    se heurtent pas sur les clés uniques. Sans effet sous SQLite. Libéré en fin de transaction."""
    if pids:
        db.execute(select(Periode.id).where(Periode.id.in_(pids)).order_by(Periode.id)
                   .with_for_update(key_share=True))


def sommes_employes(db: Session, pids: set[int]) -> dict[CleSomme, Decimal]:
    """CA et marge des employés par (période, indicateur, site, service) à chaque niveau de case
    (site ou service vide = tous), à comparer avant et après un import."""
    if not pids:
        return {}
    q = (select(SituationMensuelle.periode_id, SituationMensuelle.site_id,
                SituationMensuelle.service_id, Rubrique.libelle, Montant.valeur)
         .join(Montant, Montant.situation_id == SituationMensuelle.id)
         .join(Rubrique, Rubrique.id == Montant.rubrique_id)
         .where(SituationMensuelle.periode_id.in_(pids), Rubrique.libelle.in_(tuple(EMPLOYE))))
    out: dict[CleSomme, Decimal] = {}
    for pid, si, se, lib, v in db.execute(q):
        for case in ((si, se), (si, None), (None, se), (None, None)):
            k = (pid, EMPLOYE[lib], *case)
            out[k] = out.get(k, Decimal(0)) + _dec(v)
    return out


def noter_employes(db: Session, avant: dict[CleSomme, Decimal], pids: set[int]) -> None:
    """Date les seules cases dont la somme a vraiment changé : corriger un salaire ne doit pas
    faire passer le CA des employés devant une saisie. Pas de commit."""
    apres = sommes_employes(db, pids)
    changes = [k for k in avant.keys() | apres.keys() if avant.get(k) != apres.get(k)]
    if not changes:
        return
    maintenant = _now()
    lignes = {(d.periode_id, d.indicateur, d.site_id, d.service_id): d for d in db.scalars(
        select(DateEmployes).where(DateEmployes.periode_id.in_(pids)))}
    for k in changes:
        if k in lignes:
            lignes[k].modifie_le = maintenant
        else:
            pid, ind, si, se = k
            db.add(DateEmployes(periode_id=pid, indicateur=ind, site_id=si, service_id=se,
                                modifie_le=maintenant))


def niveau_groupe(ctx: Contexte, groupe: str) -> tuple[str, bool]:
    """Niveau en vigueur du groupe (celui des lignes existantes) et s'il est pris par défaut."""
    inds = nv.GROUPES[groupe]
    existant = nv.niveau_des_lignes([(si, se) for (ind, si, se) in ctx.lignes if ind in inds])
    if existant is not None:
        return existant, False
    return nv.niveau_par_defaut(groupe, ctx.employes), True


def niveau_precedent(db: Session, annee: int, mois: int, groupe: str) -> str | None:
    """Niveau du dernier mois antérieur qui a des lignes saisies du groupe ; None si aucun."""
    inds = nv.GROUPES[groupe]
    pid = db.scalar(
        select(Periode.id).join(ValeurSaisie, ValeurSaisie.periode_id == Periode.id)
        .where(ValeurSaisie.indicateur.in_(inds),
               Periode.annee * 12 + Periode.mois < annee * 12 + mois)
        .order_by(Periode.annee.desc(), Periode.mois.desc()).limit(1))
    if pid is None:
        return None
    rows = db.execute(select(ValeurSaisie.site_id, ValeurSaisie.service_id)
                      .where(ValeurSaisie.periode_id == pid, ValeurSaisie.indicateur.in_(inds)))
    return nv.niveau_des_lignes([(si, se) for si, se in rows])


def resolution(ctx: Contexte, groupe: str, niveau: str | None = None) -> nv.Resolution:
    niveau = niveau or niveau_groupe(ctx, groupe)[0]
    return nv.resoudre(
        groupe, niveau,
        sites=[i for i, r in ctx.sites.items() if r.actif],
        services=[i for i, r in ctx.services.items() if r.actif],
        saisies=ctx.lignes, employes=ctx.employes, dates_saisies=ctx.dates_saisies,
        dates_employes=ctx.dates_employes, tranches=ctx.tranches)


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
    """CA et marge du mois, totaux résolus du groupe (la plus récente de la saisie et de la somme
    des employés)."""
    if pid is None:
        return None, None
    t = resolution(contexte(db, pid), "ca_marge").totaux
    return t["ca"].valeur, t["marge"].valeur


def _instantane(db: Session, pid: int, groupe: str) -> dict[str, Decimal]:
    q = select(ValeurSaisie).where(ValeurSaisie.periode_id == pid,
                                   ValeurSaisie.indicateur.in_(nv.GROUPES[groupe]))
    return {f"{r.indicateur}/{r.site_id or ''}/{r.service_id or ''}": _dec(r.valeur)
            for r in db.scalars(q)}


def trancher(db: Session, user_id: int | None, pid: int, ind: str, site_id: int | None,
             service_id: int | None, choix: str, employes: Decimal) -> bool:
    """Règle un conflit. « saisie » : la saisie redevient la plus récente et le conflit est réglé
    tant que les employés ne changent pas. « employes » : la ligne saisie disparaît, la case suit
    les employés. False si la ligne n'existe pas. Pas de commit."""
    ligne = next((r for r in db.scalars(select(ValeurSaisie).where(
        ValeurSaisie.periode_id == pid, ValeurSaisie.indicateur == ind))
        if (r.site_id, r.service_id) == (site_id, service_id)), None)
    if ligne is None:
        return False
    avant = {"indicateur": ind, "site_id": site_id, "service_id": service_id,
             "saisie": format(_dec(ligne.valeur), "f"), "employes": format(employes, "f")}
    if choix == "saisie":
        maintenant = _now()
        ligne.modifie_le, ligne.tranche_le = maintenant, maintenant
    else:
        db.delete(ligne)
    db.flush()
    audit.record(db, user_id, "saisie_conflit", "periode", pid, avant, {"choix": choix})
    return True


def ecrire(db: Session, user_id: int | None, pid: int, groupe: str, niveau: str,
           valeurs: dict[nv.Cle, dict[str, Decimal | None]]) -> None:
    """Écrit les cases d'un groupe à un niveau (None = case effacée). Les lignes du groupe d'un
    autre niveau sont supprimées (un seul niveau par mois et par groupe). Trace d'audit si
    quelque chose change. Pas de commit."""
    verrouiller_periodes(db, {pid})
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
                if _dec(ligne.valeur) != v:  # 7 et 7.000 : même valeur, même date
                    ligne.modifie_le, ligne.tranche_le = _now(), None
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
