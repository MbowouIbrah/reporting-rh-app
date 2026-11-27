"""Lecture des données (toujours filtrées par périmètre) vers les structures du moteur."""

import calendar
from collections import defaultdict
from collections.abc import Collection
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.kpi import niveaux as nv
from app.kpi.moteur import (
    CA_INDIVIDUEL,
    MARGE_INDIVIDUELLE,
    Budgets,
    Ligne,
    Params,
    PeriodeData,
    Refs,
    Saisie,
    exclusions_ligne,
    total_ligne,
)
from app.models.donnees import Montant, Periode, Salarie, SituationMensuelle
from app.models.pilotage import Budget, Parametre
from app.models.referentiel import (
    Activite,
    Poste,
    Rubrique,
    RubriqueRegle,
    Service,
    Site,
    TypeContrat,
)
from app.repos import saisies as rs
from app.repos.scope import Scope, apply_scope

Choix = str | Collection[str] | None


def ens(v: Choix) -> frozenset[str] | None:
    """Valeurs d'un filtre (R4, sélection multiple) : une valeur seule ou plusieurs ; vide : aucun
    filtre. Une chaîne reste une valeur entière (jamais un test de sous-chaîne)."""
    if not v:
        return None
    return frozenset({v}) if isinstance(v, str) else frozenset(v)


def charger_refs(db: Session, type_site: Choix = None, scope: Scope | None = None) -> Refs:
    """Listes de valeurs actives ; un type de site ne garde que les sites de ce type, un périmètre
    que ses services et sites (les tableaux n'affichent pas de ligne hors périmètre)."""
    types = ens(type_site)

    def libs(model):
        q = select(model.libelle).where(model.actif).order_by(model.id)
        if types and model is Site:
            q = q.where(Site.type_site.in_(types))
        dim = {Service: "service", Site: "site"}.get(model)
        if scope and not scope.unrestricted and dim in scope.rules:
            q = q.where(model.libelle.in_(scope.rules[dim]))
        return tuple(db.scalars(q))

    rub = tuple(db.scalars(select(Rubrique.libelle).where(Rubrique.actif, Rubrique.nature == "paie")
                          .order_by(Rubrique.ordre)))
    return Refs(libs(Service), libs(Activite), libs(Site), libs(TypeContrat), rub)


def rubriques_paie(db: Session) -> tuple[str, ...]:
    """Toutes les rubriques de paie, actives ou non, dans l'ordre du référentiel : une rubrique
    désactivée garde ses montants dans les données et dans le total."""
    return tuple(db.scalars(select(Rubrique.libelle).where(Rubrique.nature == "paie")
                            .order_by(Rubrique.ordre)))


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
                    service: Choix, site: Choix, *, type_site: Choix = None,
                    poste: Choix = None, salarie_id: int | None = None,
                    activite: Choix = None, type_contrat: Choix = None) -> Budgets:
    """Budgets de la période visibles pour ce périmètre et ces filtres : un budget n'est montré
    que si le réel correspondant est complet (pas de budget par rubrique hors périmètre global).
    Aucun budget pour un poste, une activité ou une personne ; un type de site ne garde que les
    budgets site."""
    if poste or activite or type_contrat or salarie_id is not None:
        return Budgets()
    pid = db.scalar(select(Periode.id).where(Periode.annee == annee, Periode.mois == mois))
    if pid is None:
        return Budgets()
    service, site, type_site = ens(service), ens(site), ens(type_site)

    def lus(axe: str, model) -> dict[str, Decimal]:
        q = (select(model.libelle, Budget.valeur)
             .join(model, model.id == Budget.cible_id)
             .where(Budget.periode_id == pid, Budget.axe == axe, model.actif))
        if model is Rubrique:
            q = q.where(Rubrique.nature == "paie")
        if type_site and model is Site:
            q = q.where(Site.type_site.in_(type_site))
        return {lib: Decimal(str(v)) for lib, v in db.execute(q)}

    def visible(vals: dict[str, Decimal], dim: str, autre, choisi: frozenset[str] | None):
        if autre:
            return {}
        if not scope.unrestricted:
            # Accès restreint sur l'autre dimension : le budget la déborde, il reste masqué.
            if scope.rules.get("site" if dim == "service" else "service"):
                return {}
            vals = {k: v for k, v in vals.items() if k in scope.rules.get(dim, ())}
        return {k: v for k, v in vals.items() if choisi is None or k in choisi}

    global_ = scope.unrestricted and not service and not site and not type_site
    rubrique = lus("rubrique", Rubrique) if global_ else {}
    services = {} if type_site else visible(lus("service", Service), "service", site, service)
    return Budgets(rubrique, services, visible(lus("site", Site), "site", service, site))


def exclues_a_date(db: Session, annee: int, mois: int) -> frozenset[str]:
    d = date(annee, mois, 1)
    q = (select(Rubrique.libelle)
         .join(RubriqueRegle, RubriqueRegle.rubrique_id == Rubrique.id)
         .where(Rubrique.nature == "paie",
                RubriqueRegle.regle == "exclu_total_ligne", RubriqueRegle.date_debut <= d,
                (RubriqueRegle.date_fin.is_(None)) | (RubriqueRegle.date_fin >= d)))
    return frozenset(db.scalars(q))


def charger_periode(db: Session, scope: Scope, annee: int, mois: int) -> PeriodeData | None:
    periode = db.scalar(select(Periode).where(Periode.annee == annee, Periode.mois == mois))
    if periode is None:
        return None
    q = apply_scope(
        select(SituationMensuelle.id, SituationMensuelle.salarie_id, Service.libelle,
               Site.libelle, Activite.libelle, TypeContrat.libelle, Site.type_site, Poste.libelle,
               SituationMensuelle.reference_activite, Service.productif,
               Salarie.sexe, Salarie.date_naissance, Salarie.date_embauche)
        .join(Salarie, Salarie.id == SituationMensuelle.salarie_id)
        .join(Service, Service.id == SituationMensuelle.service_id)
        .join(Site, Site.id == SituationMensuelle.site_id)
        .join(Activite, Activite.id == SituationMensuelle.activite_id)
        .join(TypeContrat, TypeContrat.id == SituationMensuelle.type_contrat_id)
        .outerjoin(Poste, Poste.id == SituationMensuelle.poste_id)
        .where(SituationMensuelle.periode_id == periode.id),
        scope, service=Service.libelle, site=Site.libelle)
    rows = db.execute(q).all()
    montants: dict[int, dict[str, Decimal]] = defaultdict(dict)
    indicateurs: dict[int, dict[str, Decimal]] = defaultdict(dict)
    if rows:
        mq = (select(Montant.situation_id, Rubrique.libelle, Montant.valeur, Rubrique.nature)
              .join(Rubrique, Rubrique.id == Montant.rubrique_id)
              .where(Montant.situation_id.in_([r[0] for r in rows])))
        for sid, rub, val, nature in db.execute(mq):
            # la paie et l'activité sont séparées dès la lecture : le moteur de paie ne voit
            # jamais une rubrique d'activité
            (montants if nature == "paie" else indicateurs)[sid][rub] = Decimal(str(val))
    lignes = tuple(Ligne(sal, srv, site, act, ctr, montants.get(sid, {}), tsite, poste,
                         indicateurs.get(sid, {}), ref, bool(prod), sexe, naiss, emb)
                   for (sid, sal, srv, site, act, ctr, tsite, poste, ref, prod,
                        sexe, naiss, emb) in rows)
    saisies, vides = _saisies_visibles(db, scope, periode.id)
    fin = date(annee, mois, calendar.monthrange(annee, mois)[1])
    return PeriodeData(lignes, exclues_a_date(db, annee, mois), ca=_total(saisies, "ca"),
                       marge=_total(saisies, "marge"), saisies=saisies, vides=vides, fin=fin)


def _saisies_visibles(db: Session, scope: Scope, pid: int) -> tuple[tuple[Saisie, ...],
                                                                   tuple[Saisie, ...]]:
    """Valeurs saisies ou calculées des deux groupes (CA et marge, activité) à leur niveau, dans
    le périmètre : (cases avec valeur, cases attendues restées vides)."""
    ctx = rs.contexte(db, pid)
    avec: list[Saisie] = []
    vides: list[Saisie] = []
    for groupe in nv.GROUPES:
        for case in rs.resolution(ctx, groupe).cases:
            site, service = ctx.sites.get(case.site_id), ctx.services.get(case.service_id)
            if not rs.dans_perimetre(scope, site and site.libelle, service and service.libelle):
                continue
            for ind, v in case.valeurs.items():
                (avec if v.valeur is not None else vides).append(Saisie(
                    service and service.libelle, site and site.libelle, site and site.type_site,
                    ind, v.valeur))
    return tuple(avec), tuple(vides)


def _total(saisies: tuple[Saisie, ...], indicateur: str) -> Decimal | None:
    vals = [s.valeur for s in saisies if s.indicateur == indicateur]
    return sum(vals, Decimal(0)) if vals else None


def texte_montant(v: Decimal) -> str:
    """Montant en texte, toutes ses décimales, au moins 3 (zéros ajoutés, jamais d'arrondi)."""
    v = Decimal(v).normalize()
    return f"{v if v.as_tuple().exponent <= -3 else v.quantize(Decimal('0.001')):f}"


def rubriques_exclues(db: Session) -> frozenset[str]:
    """Rubriques exclues du TOTAL sur au moins une période (colonnes isolées dans DONNEES)."""
    q = (select(Rubrique.libelle).join(RubriqueRegle, RubriqueRegle.rubrique_id == Rubrique.id)
         .where(Rubrique.nature == "paie", RubriqueRegle.regle == "exclu_total_ligne"))
    return frozenset(db.scalars(q))


def _situations_tableau(scope: Scope, annee: int | None, mois: int | None, service: str | None,
                        site: str | None, recherche: str | None, matricule: str | None = None):
    q = apply_scope(
        select(SituationMensuelle.id, Periode.annee, Periode.mois, Salarie.matricule, Salarie.nom,
               Poste.libelle, TypeContrat.libelle, Activite.libelle, Site.libelle, Service.libelle,
               SituationMensuelle.reference_activite)
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
                    matricule: str | None = None, avec_marge: bool = False) -> list[dict]:
    """Lignes de la feuille DONNEES (une par employé et par mois), dans le périmètre.
    `montants` ne porte que la paie ; les rubriques d'activité sont dans `indicateurs`, CA et marge
    individuels seulement avec `avec_marge` (droit marge:read)."""
    q = _situations_tableau(scope, annee, mois, service, site, recherche, matricule)
    rows = db.execute(q).all()
    montants: dict[int, dict[str, Decimal]] = defaultdict(dict)
    indicateurs: dict[int, dict[str, Decimal]] = defaultdict(dict)
    if rows:
        ids = q.with_only_columns(SituationMensuelle.id).order_by(None)
        mq = (select(Montant.situation_id, Rubrique.libelle, Montant.valeur, Rubrique.nature)
              .join(Rubrique, Rubrique.id == Montant.rubrique_id)
              .where(Montant.situation_id.in_(ids)))
        for sid, rub, val, nature in db.execute(mq):
            if nature == "paie":
                montants[sid][rub] = Decimal(str(val))
            elif avec_marge or rub not in (CA_INDIVIDUEL, MARGE_INDIVIDUELLE):
                indicateurs[sid][rub] = Decimal(str(val))
    exclues: dict[tuple[int, int], frozenset[str]] = {}
    out = []
    for sid, a, m, mat, nom, poste, ctr, act, site_, srv, ref in rows:
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
            "indicateurs": {k: texte_montant(v) for k, v in indicateurs.get(sid, {}).items()},
            "reference": ref,
        })
    return out


def options_tableau(db: Session, scope: Scope, choix: dict | None = None) -> dict:
    """Valeurs proposées par les filtres du tableau, limitées au périmètre. Chaque liste ne garde
    que les valeurs compatibles avec les autres filtres choisis (aucun choix ne mène à un tableau
    vide) ; la valeur choisie reste proposée."""
    c = {k: v for k, v in (choix or {}).items() if v not in (None, "")}

    def base(sauf: str):
        autres = {k: v for k, v in c.items() if k != sauf}
        return _situations_tableau(scope, autres.get("annee"), autres.get("mois"),
                                   autres.get("service"), autres.get("site"), None,
                                   autres.get("matricule")).order_by(None)

    def distinctes(cle: str, col) -> list:
        vals = {v for v in db.scalars(base(cle).with_only_columns(col).distinct()) if v is not None}
        if cle in c:
            vals.add(c[cle])
        return sorted(vals)

    salaries = dict(db.execute(base("matricule").with_only_columns(Salarie.matricule, Salarie.nom)
                               .distinct()).all())
    if "matricule" in c and c["matricule"] not in salaries:
        salaries.update(db.execute(select(Salarie.matricule, Salarie.nom)
                                   .where(Salarie.matricule == c["matricule"])).all())
    return {"annees": distinctes("annee", Periode.annee),
            "mois": distinctes("mois", Periode.mois),
            "services": distinctes("service", Service.libelle),
            "sites": distinctes("site", Site.libelle),
            "salaries": [{"matricule": m, "nom": n}
                         for m, n in sorted(salaries.items(), key=lambda x: (x[1] or "", x[0]))]}


def filtrer(pd: PeriodeData | None, service: Choix, site: Choix, *,
            type_site: Choix = None, poste: Choix = None,
            salarie_id: int | None = None, activite: Choix = None,
            type_contrat: Choix = None) -> PeriodeData | None:
    """Filtre d'affichage choisi par l'utilisateur, appliqué après le périmètre (jamais en deçà)."""
    if pd is None:
        return None
    service, site, type_site = ens(service), ens(site), ens(type_site)
    poste, activite, type_contrat = ens(poste), ens(activite), ens(type_contrat)
    lignes = tuple(L for L in pd.lignes
                   if (not service or L.service in service) and (not site or L.site in site)
                   and (not type_site or L.type_site in type_site)
                   and (not poste or L.poste in poste)
                   and (not activite or L.activite in activite)
                   and (not type_contrat or L.contrat in type_contrat)
                   and (salarie_id is None or L.salarie_id == salarie_id))
    # Une saisie (CA, marge, OR, devis, factures) n'est gardée que si son niveau permet de
    # répondre au filtre : un filtre site ou type de site veut un site renseigné, un filtre service
    # un service renseigné. Poste, activité, contrat et personne n'ont aucune saisie.
    sans_saisie = poste or activite or type_contrat or salarie_id is not None

    def gardee(s: Saisie) -> bool:
        return not sans_saisie and (
            (not service or s.service in service)
            and (not site or s.site in site)
            and (not type_site or s.type_site in type_site))

    saisies = tuple(s for s in pd.saisies if gardee(s))
    return PeriodeData(lignes, pd.exclues, ca=_total(saisies, "ca"), marge=_total(saisies, "marge"),
                       saisies=saisies, vides=tuple(s for s in pd.vides if gardee(s)), fin=pd.fin)


def precedente(annee: int, mois: int) -> tuple[int, int]:
    return (annee - 1, 12) if mois == 1 else (annee, mois - 1)
