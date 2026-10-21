"""Lecture des données (toujours filtrées par périmètre) vers les structures du moteur."""

from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.kpi.moteur import Budgets, Ligne, Params, PeriodeData, Refs, exclusions_ligne, total_ligne
from app.models.donnees import Montant, Periode, Salarie, SituationMensuelle
from app.models.pilotage import Budget, CaPeriode, Parametre
from app.models.referentiel import (
    Activite,
    Poste,
    Rubrique,
    RubriqueRegle,
    Service,
    Site,
    TypeContrat,
)
from app.repos.scope import Scope, apply_scope


def charger_refs(db: Session, type_site: str | None = None, scope: Scope | None = None) -> Refs:
    """Référentiels actifs ; un type de site ne garde que les sites de ce type, un périmètre
    que ses services et sites (les tableaux n'affichent pas de ligne hors périmètre)."""
    def libs(model):
        q = select(model.libelle).where(model.actif).order_by(model.id)
        if type_site and model is Site:
            q = q.where(Site.type_site == type_site)
        dim = {Service: "service", Site: "site"}.get(model)
        if scope and not scope.unrestricted and dim in scope.rules:
            q = q.where(model.libelle.in_(scope.rules[dim]))
        return tuple(db.scalars(q))

    rub = tuple(db.scalars(select(Rubrique.libelle).where(Rubrique.actif).order_by(Rubrique.ordre)))
    return Refs(libs(Service), libs(Activite), libs(Site), libs(TypeContrat), rub)


def charger_params(db: Session, annee: int, mois: int) -> Params:
    d = date(annee, mois, 1)
    valeurs: dict[str, Decimal] = {}
    q = select(Parametre).where(Parametre.date_debut <= d).order_by(Parametre.date_debut)
    for p in db.scalars(q):
        valeurs[p.cle] = Decimal(p.valeur)
    defaut = Params()
    return Params(valeurs.get("jours_ouvres", defaut.jours_ouvres),
                  valeurs.get("budget_employe", defaut.budget_employe))


def charger_budgets(db: Session, scope: Scope, annee: int, mois: int,
                    service: str | None, site: str | None, *, type_site: str | None = None,
                    poste: str | None = None, salarie_id: int | None = None,
                    activite: str | None = None, type_contrat: str | None = None) -> Budgets:
    """Budgets de la période visibles pour ce périmètre et ces filtres : un budget n'est montré
    que si le réel correspondant est complet (pas de budget par rubrique hors périmètre global).
    Aucun budget pour un poste, une activité ou une personne ; un type de site ne garde que les
    budgets site."""
    if poste or activite or type_contrat or salarie_id is not None:
        return Budgets()
    pid = db.scalar(select(Periode.id).where(Periode.annee == annee, Periode.mois == mois))
    if pid is None:
        return Budgets()

    def lus(axe: str, model) -> dict[str, Decimal]:
        q = (select(model.libelle, Budget.valeur)
             .join(model, model.id == Budget.cible_id)
             .where(Budget.periode_id == pid, Budget.axe == axe, model.actif))
        if type_site and model is Site:
            q = q.where(Site.type_site == type_site)
        return {lib: Decimal(str(v)) for lib, v in db.execute(q)}

    def visible(vals: dict[str, Decimal], dim: str, autre: str | None, choisi: str | None):
        if autre:
            return {}
        if not scope.unrestricted:
            # Accès restreint sur l'autre dimension : le budget la déborde, il reste masqué.
            if scope.rules.get("site" if dim == "service" else "service"):
                return {}
            vals = {k: v for k, v in vals.items() if k in scope.rules.get(dim, ())}
        return {k: v for k, v in vals.items() if choisi in (None, k)}

    global_ = scope.unrestricted and not service and not site and not type_site
    rubrique = lus("rubrique", Rubrique) if global_ else {}
    services = {} if type_site else visible(lus("service", Service), "service", site, service)
    return Budgets(rubrique, services, visible(lus("site", Site), "site", service, site))


def exclues_a_date(db: Session, annee: int, mois: int) -> frozenset[str]:
    d = date(annee, mois, 1)
    q = (select(Rubrique.libelle)
         .join(RubriqueRegle, RubriqueRegle.rubrique_id == Rubrique.id)
         .where(RubriqueRegle.regle == "exclu_total_ligne", RubriqueRegle.date_debut <= d,
                (RubriqueRegle.date_fin.is_(None)) | (RubriqueRegle.date_fin >= d)))
    return frozenset(db.scalars(q))


def charger_periode(db: Session, scope: Scope, annee: int, mois: int) -> PeriodeData | None:
    periode = db.scalar(select(Periode).where(Periode.annee == annee, Periode.mois == mois))
    if periode is None:
        return None
    q = apply_scope(
        select(SituationMensuelle.id, SituationMensuelle.salarie_id, Service.libelle,
               Site.libelle, Activite.libelle, TypeContrat.libelle, Site.type_site, Poste.libelle)
        .join(Service, Service.id == SituationMensuelle.service_id)
        .join(Site, Site.id == SituationMensuelle.site_id)
        .join(Activite, Activite.id == SituationMensuelle.activite_id)
        .join(TypeContrat, TypeContrat.id == SituationMensuelle.type_contrat_id)
        .outerjoin(Poste, Poste.id == SituationMensuelle.poste_id)
        .where(SituationMensuelle.periode_id == periode.id),
        scope, service=Service.libelle, site=Site.libelle)
    rows = db.execute(q).all()
    montants: dict[int, dict[str, Decimal]] = defaultdict(dict)
    if rows:
        mq = (select(Montant.situation_id, Rubrique.libelle, Montant.valeur)
              .join(Rubrique, Rubrique.id == Montant.rubrique_id)
              .where(Montant.situation_id.in_([r[0] for r in rows])))
        for sid, rub, val in db.execute(mq):
            montants[sid][rub] = Decimal(str(val))
    saisie = db.get(CaPeriode, periode.id)
    lignes = tuple(Ligne(sal, srv, site, act, ctr, montants.get(sid, {}), tsite, poste)
                   for sid, sal, srv, site, act, ctr, tsite, poste in rows)
    return PeriodeData(lignes, exclues_a_date(db, annee, mois),
                       ca=_dec(saisie.valeur) if saisie else None,
                       marge=_dec(saisie.marge) if saisie else None)


def _dec(v) -> Decimal | None:
    """SQLite renvoie des float pour NUMERIC."""
    return None if v is None else Decimal(str(v))


def texte_montant(v: Decimal) -> str:
    """Montant en texte, toutes ses décimales, au moins 3 (zéros ajoutés, jamais d'arrondi)."""
    v = Decimal(v).normalize()
    return f"{v if v.as_tuple().exponent <= -3 else v.quantize(Decimal('0.001')):f}"


def rubriques_exclues(db: Session) -> frozenset[str]:
    """Rubriques exclues du TOTAL sur au moins une période (colonnes isolées dans DONNEES)."""
    q = (select(Rubrique.libelle).join(RubriqueRegle, RubriqueRegle.rubrique_id == Rubrique.id)
         .where(RubriqueRegle.regle == "exclu_total_ligne"))
    return frozenset(db.scalars(q))


def _situations_tableau(scope: Scope, annee: int | None, mois: int | None, service: str | None,
                        site: str | None, recherche: str | None, matricule: str | None = None):
    q = apply_scope(
        select(SituationMensuelle.id, Periode.annee, Periode.mois, Salarie.matricule, Salarie.nom,
               Poste.libelle, TypeContrat.libelle, Activite.libelle, Site.libelle, Service.libelle)
        .join(Periode, Periode.id == SituationMensuelle.periode_id)
        .join(Salarie, Salarie.id == SituationMensuelle.salarie_id)
        .outerjoin(Poste, Poste.id == SituationMensuelle.poste_id)
        .join(TypeContrat, TypeContrat.id == SituationMensuelle.type_contrat_id)
        .join(Activite, Activite.id == SituationMensuelle.activite_id)
        .join(Site, Site.id == SituationMensuelle.site_id)
        .join(Service, Service.id == SituationMensuelle.service_id),
        scope, service=Service.libelle, site=Site.libelle)
    for col, val in ((Periode.annee, annee), (Periode.mois, mois), (Service.libelle, service),
                     (Site.libelle, site), (Salarie.matricule, matricule)):
        if val is not None and val != "":
            q = q.where(col == val)
    if recherche:
        t = recherche.strip()
        q = q.where(Salarie.matricule.icontains(t, autoescape=True)
                    | Salarie.nom.icontains(t, autoescape=True))
    return q.order_by(Periode.annee, Periode.mois, Salarie.matricule)


def charger_tableau(db: Session, scope: Scope, *, annee: int | None = None,
                    mois: int | None = None, service: str | None = None,
                    site: str | None = None, recherche: str | None = None,
                    matricule: str | None = None) -> list[dict]:
    """Lignes de la feuille DONNEES (une par employé et par mois), dans le périmètre."""
    q = _situations_tableau(scope, annee, mois, service, site, recherche, matricule)
    rows = db.execute(q).all()
    montants: dict[int, dict[str, Decimal]] = defaultdict(dict)
    if rows:
        ids = q.with_only_columns(SituationMensuelle.id).order_by(None)
        mq = (select(Montant.situation_id, Rubrique.libelle, Montant.valeur)
              .join(Rubrique, Rubrique.id == Montant.rubrique_id)
              .where(Montant.situation_id.in_(ids)))
        for sid, rub, val in db.execute(mq):
            montants[sid][rub] = Decimal(str(val))
    exclues: dict[tuple[int, int], frozenset[str]] = {}
    out = []
    for sid, a, m, mat, nom, poste, ctr, act, site_, srv in rows:
        ex = exclues.get((a, m))
        if ex is None:
            ex = exclues[(a, m)] = exclues_a_date(db, a, m)
        mt = montants.get(sid, {})
        out.append({
            "annee": a, "mois": m, "matricule": mat, "nom": nom, "poste": poste,
            "type_contrat": ctr, "activite": act, "site": site_, "service": srv,
            "montants": {k: texte_montant(v) for k, v in mt.items()},
            "total": texte_montant(total_ligne(mt, ex)),
            "exclusions": texte_montant(exclusions_ligne(mt, ex)),
        })
    return out


def options_tableau(db: Session, scope: Scope) -> dict:
    """Valeurs proposées par les filtres du tableau, limitées au périmètre."""
    base = _situations_tableau(scope, None, None, None, None, None).order_by(None)

    def distinctes(col) -> list:
        vals = db.scalars(base.with_only_columns(col).distinct())
        return sorted(v for v in vals if v is not None)

    salaries = db.execute(base.with_only_columns(Salarie.matricule, Salarie.nom).distinct()
                          .order_by(Salarie.nom, Salarie.matricule))
    return {"annees": distinctes(Periode.annee), "services": distinctes(Service.libelle),
            "sites": distinctes(Site.libelle),
            "salaries": [{"matricule": m, "nom": n} for m, n in salaries]}


def filtrer(pd: PeriodeData | None, service: str | None, site: str | None, *,
            type_site: str | None = None, poste: str | None = None,
            salarie_id: int | None = None, activite: str | None = None,
            type_contrat: str | None = None) -> PeriodeData | None:
    """Filtre d'affichage choisi par l'utilisateur, appliqué après le périmètre (jamais en deçà)."""
    if pd is None:
        return None
    lignes = tuple(L for L in pd.lignes
                   if (not service or L.service == service) and (not site or L.site == site)
                   and (not type_site or L.type_site == type_site)
                   and (not poste or L.poste == poste)
                   and (not activite or L.activite == activite)
                   and (not type_contrat or L.contrat == type_contrat)
                   and (salarie_id is None or L.salarie_id == salarie_id))
    # Le CA est global : il n'existe pas pour un service, un site, un type de site, un poste,
    # une activité ou une personne, donc ni marge ni taux.
    global_ = not (service or site or type_site or poste or activite or type_contrat
                    or salarie_id is not None)
    return PeriodeData(lignes, pd.exclues, ca=pd.ca if global_ else None,
                       marge=pd.marge if global_ else None)


def precedente(annee: int, mois: int) -> tuple[int, int]:
    return (annee - 1, 12) if mois == 1 else (annee, mois - 1)
