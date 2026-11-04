"""Construction des restitutions (mensuel, annuel, individuel) à partir de lignes déjà filtrées.

Aucune dépendance base de données : l'entrée est une liste de `Ligne` par période.
"""

from collections import defaultdict
from dataclasses import dataclass, field, replace
from decimal import Decimal

from app.kpi import formules as f

ABSENCES = "Absences (nb)"
COMMISSION = "Commission"
FRAIS_MISSION = "Frais de mission"
LOGEMENT = "Logement site déporté"
ASSURANCE = "Assurance Maladie"
FORMATION = "Formation"
CARBURANT = "Carburant véhicule service"
CREDIT_TEL = "Crédit téléphonique"
PRIMES = ("Primes sur ventes", "Primes sur résultats", "Productivité Ateliers")
# Graphiques « Salaire par mois » et « Primes par mois ».
SALAIRE = "Salaire brut garantie"
PRIMES_TOUTES = ("Bonus", "Primes exceptionnelles", *PRIMES, COMMISSION)

# Rubriques de nature « activité » : jamais dans les montants de paie.
VENTES = "Nombre de ventes"
CLIENTS = "Nombre de clients"
PRODUCTIVITE = "Indice de productivité"
CA_INDIVIDUEL = "CA individuel"
MARGE_INDIVIDUELLE = "Marge individuelle"
RUBRIQUES_ACTIVITE = (
    (VENTES, "nombre"), (CLIENTS, "nombre"), (PRODUCTIVITE, "nombre"),
    (CA_INDIVIDUEL, "FCFA"), (MARGE_INDIVIDUELLE, "FCFA"),
)
REFERENCE_COLONNE = "Référence reporting"
ZERO = Decimal(0)


def total_ligne(montants: dict[str, Decimal], exclues: frozenset[str]) -> Decimal:
    """TOTAL CHARGES d'une ligne : somme des rubriques non exclues."""
    return sum((v for r, v in montants.items() if r not in exclues), ZERO)


def exclusions_ligne(montants: dict[str, Decimal], exclues: frozenset[str]) -> Decimal:
    """Total exclusions (technique) de DONNEES : somme des rubriques exclues, absences comprises."""
    return sum((v for r, v in montants.items() if r in exclues), ZERO)


@dataclass(frozen=True)
class Ligne:
    salarie_id: int
    service: str
    site: str
    activite: str
    contrat: str
    montants: dict[str, Decimal] = field(default_factory=dict)  # libellé rubrique -> valeur
    type_site: str = "principal"
    poste: str | None = None
    indicateurs: dict[str, Decimal] = field(default_factory=dict)  # rubriques d'activité
    reference: str | None = None  # référence reporting (texte libre)
    productif: bool = False  # service marqué productif


@dataclass(frozen=True)
class Saisie:
    """Valeur d'un indicateur saisi ou calculé depuis les employés (CA, marge, OR, devis, factures),
    à son niveau : site et service renseignés ou non selon que le niveau les distingue. Une valeur
    None est une case attendue restée vide (le total est alors partiel)."""

    service: str | None
    site: str | None
    type_site: str | None
    indicateur: str  # ca | marge | or | devis | factures
    valeur: Decimal | None


@dataclass(frozen=True)
class PeriodeData:
    lignes: tuple[Ligne, ...]
    exclues: frozenset[str] = frozenset()  # rubriques hors TOTAL CHARGES à la date de la période
    ca: Decimal | None = None
    marge: Decimal | None = None  # saisie avec le CA
    saisies: tuple[Saisie, ...] = ()
    vides: tuple[Saisie, ...] = ()  # cases attendues sans valeur (valeur None)

    @property
    def partiel(self) -> frozenset[str]:
        """Indicateurs dont le total du mois existe mais ignore au moins une case attendue."""
        avec = {s.indicateur for s in self.saisies}
        return frozenset(s.indicateur for s in self.vides if s.indicateur in avec)

    def total(self, ligne: Ligne) -> Decimal:
        return total_ligne(ligne.montants, self.exclues)

    @property
    def ids(self) -> frozenset[int]:
        return frozenset(L.salarie_id for L in self.lignes)

    @property
    def ms(self) -> Decimal:
        return sum((self.total(L) for L in self.lignes), ZERO)

    def rubrique(self, nom: str) -> Decimal:
        return sum((L.montants.get(nom, ZERO) for L in self.lignes), ZERO)


@dataclass(frozen=True)
class Refs:
    services: tuple[str, ...]
    activites: tuple[str, ...]
    sites: tuple[str, ...]
    contrats: tuple[str, ...]
    rubriques: tuple[str, ...]


FACULTATIFS = ("Stage",)  # contrats affichés seulement s'ils ont au moins une ligne


def _contrats_vus(refs: Refs, *pds: PeriodeData | None) -> Refs:
    vus = {L.contrat for pd in pds if pd for L in pd.lignes}
    return replace(refs, contrats=tuple(
        c for c in refs.contrats if c not in FACULTATIFS or c in vus))


@dataclass(frozen=True)
class Params:
    jours_ouvres: Decimal = Decimal(22)
    budget_employe: Decimal | None = Decimal(600000)


@dataclass(frozen=True)
class Budgets:
    """Budgets mensuels saisis, par libellé (rubrique, service, site)."""

    rubrique: dict[str, Decimal] = field(default_factory=dict)
    service: dict[str, Decimal] = field(default_factory=dict)
    site: dict[str, Decimal] = field(default_factory=dict)


def _bud(m: Decimal | None, b: Decimal | None) -> dict:
    ecart, pct = f.ecart_budget(m, b)
    return {"budget": b, "ecart": ecart, "ecart_pct": pct}


def _ok(pd: PeriodeData | None) -> PeriodeData | None:
    return pd if pd is not None and pd.lignes else None


# Ligne du rapport -> indicateur d'objectif saisi (groupes obj_ca_marge et obj_activite).
OBJECTIF = {"ca": "obj_ca", "marge": "obj_marge", "ventes": "obj_ventes",
            "clients": "obj_clients", "factures": "obj_factures",
            "productivite": "obj_productivite"}
OBJECTIFS_ACTIVITE = ("ventes", "clients", "productivite", "factures")


def _objectifs(pd: PeriodeData | None, budgets: Budgets, params: Params) -> dict:
    """Objectifs d'un mois (None = non défini) : masse salariale (budget par employé x effectif),
    budgets de rubrique saisis (frais de mission, commissions, rémunération globale = toutes les
    rubriques hors absences), puis valeurs d'objectif saisies (somme des cases, moyenne pour la
    productivité)."""
    saisies = pd.saisies if pd else ()

    def saisi(cle: str) -> Decimal | None:
        vals = [s.valeur for s in saisies if s.indicateur == OBJECTIF[cle]]
        return (_moyenne_opt if cle == "productivite" else _somme_opt)(vals)

    rub = budgets.rubrique
    paie = [v for r, v in rub.items() if r != ABSENCES]
    return {
        "ms": f.budget(len(pd.ids), params.budget_employe) if _ok(pd) else None,
        "frais_mission": rub.get(FRAIS_MISSION),
        "commissions": rub.get(COMMISSION),
        "remuneration": sum(paie, ZERO) if paie else None,
        **{cle: saisi(cle) for cle in OBJECTIF},
    }


def _budget_partiel(partiel: frozenset[str]) -> bool:
    """Un objectif d'activité (ventes, clients, productivité, factures) a une case attendue vide.
    CA et marge n'y comptent pas : leur état n'est donné qu'avec le droit marge."""
    return any(OBJECTIF[k] in partiel for k in OBJECTIFS_ACTIVITE)


def _avec_objectif(c: dict, cle: str, objectif: Decimal | None,
                   partiel: frozenset[str]) -> dict:
    """Cellule du réel complétée de son objectif (budget, écart, écart %) ; `budget_partiel` si
    une case attendue de l'objectif manque."""
    out = {**c, **_bud(c["m"], objectif)}
    return {**out, "budget_partiel": True} if OBJECTIF[cle] in partiel else out


def _ca_marge(pd: PeriodeData | None) -> dict:
    ca, marge = (pd.ca, pd.marge) if pd else (None, None)
    return {"ca": ca, "marge": marge, "taux_marge": f.taux_marge(ca, marge)}


LIGNES_ACTIVITE = (
    ("ventes", "Nombre de ventes"), ("clients", "Nombre de clients"),
    ("productivite", "Indice de productivité (moyenne)"), ("or", "OR"), ("devis", "Devis"),
    ("factures", "Factures"), ("productifs", "Productifs (effectif)"),
    ("or_par_productif", "OR par productif"), ("factures_par_productif", "Factures par productif"),
)
DONNEES_ACTIVITE = ("ventes", "clients", "productivite", "or", "devis", "factures")


def _somme_opt(vals) -> Decimal | None:
    vals = list(vals)
    return sum(vals, ZERO) if vals else None


def _moyenne_opt(vals) -> Decimal | None:
    vals = list(vals)
    return sum(vals, ZERO) / len(vals) if vals else None


def _ratio(a: Decimal | None, b: Decimal | None) -> Decimal | None:
    return None if a is None or not b else a / b


def _activite(pd: PeriodeData | None) -> dict:
    """Valeurs brutes d'activité d'un mois (CA et marge individuels n'y figurent pas).
    Les effectifs productifs restent inconnus (None) tant que le mois n'a pas de ligne de paie."""
    lignes = pd.lignes if pd else ()

    def indic(nom):
        return _somme_opt(L.indicateurs[nom] for L in lignes if nom in L.indicateurs)

    def saisi(nom):
        return _somme_opt(s.valeur for s in (pd.saisies if pd else ()) if s.indicateur == nom)

    productifs = Decimal(len({L.salarie_id for L in lignes if L.productif})) if lignes else None
    or_, factures = saisi("or"), saisi("factures")
    return {
        "ventes": indic(VENTES), "clients": indic(CLIENTS),
        "productivite": _moyenne_opt(L.indicateurs[PRODUCTIVITE] for L in lignes
                                     if PRODUCTIVITE in L.indicateurs),
        "or": or_, "devis": saisi("devis"), "factures": factures, "productifs": productifs,
        "or_par_productif": _ratio(or_, productifs),
        "factures_par_productif": _ratio(factures, productifs),
    }


def _avec_partiel(c: dict, partiel: bool) -> dict:
    return {**c, "partiel": True} if partiel else c


def _bloc_activite(a: dict, a1: dict, partiel: frozenset[str] = frozenset(),
                   objectifs: dict | None = None) -> list[dict] | None:
    """Bloc ACTIVITÉ : masqué (None) tant qu'aucune donnée d'activité n'existe des deux côtés.
    `partiel` : indicateurs dont une case attendue manque ; le ratio qui en dépend l'est aussi.
    `objectifs` : objectif de ventes, clients, productivité et factures (budget sur ces lignes)."""
    if all(a[k] is None and a1[k] is None for k in DONNEES_ACTIVITE):
        return None
    dep = {"or_par_productif": "or", "factures_par_productif": "factures"}
    def ligne(k: str) -> dict:
        c = _avec_partiel(cell(a[k], a1[k]), dep.get(k, k) in partiel)
        if objectifs is not None and k in OBJECTIFS_ACTIVITE:
            c = _avec_objectif(c, k, objectifs.get(k), partiel)
        return c

    return [{"cle": k, "libelle": lib, **ligne(k)} for k, lib in LIGNES_ACTIVITE]


def _activite_cumul(pds: dict[int, PeriodeData], mois: int) -> dict:
    """Cumul de janvier à `mois` : sommes sur les mois qui ont la donnée, indice moyen sur toutes
    les lignes renseignées, productifs en effectif moyen des mois de paie, ratios sur lui."""
    tous = [m for m in sorted(pds) if m <= mois]
    ok = avec_donnees(pds, mois)
    par_mois = {m: _activite(pds[m]) for m in tous}

    def somme(k):
        return _somme_opt(par_mois[m][k] for m in tous if par_mois[m][k] is not None)

    prods = _moyenne_opt(par_mois[m]["productifs"] for m in ok)
    or_, factures = somme("or"), somme("factures")
    return {
        "ventes": somme("ventes"), "clients": somme("clients"),
        "productivite": _moyenne_opt(L.indicateurs[PRODUCTIVITE] for m in tous
                                     for L in pds[m].lignes if PRODUCTIVITE in L.indicateurs),
        "or": or_, "devis": somme("devis"), "factures": factures, "productifs": prods,
        "or_par_productif": _ratio(or_, prods), "factures_par_productif": _ratio(factures, prods),
    }


def cell(m: Decimal | None, m1: Decimal | None) -> dict:
    return {"m1": m1, "m": m, "var": f.variation(m, m1), "var_pct": f.variation_pct(m, m1)}


def _somme(cells: list[dict], budget: bool = False) -> dict:
    """Ligne TOTAL GÉNÉRAL d'un tableau : somme des lignes affichées, variations recalculées."""
    def tot(k):
        vals = [c[k] for c in cells if c[k] is not None]
        return sum(vals, ZERO) if vals else None
    m, m1 = tot("m"), tot("m1")
    return {**cell(m, m1), **(_bud(m, tot("budget")) if budget else {})}


def _part(pd: PeriodeData | None, r: str, compte: bool) -> Decimal | None:
    """Montant de la rubrique compté dans le total (compte=True) ou hors total, selon les
    exclusions de CETTE période (une exclusion peut changer d'un mois à l'autre)."""
    if pd is None:
        return None
    return pd.rubrique(r) if (r in pd.exclues) != compte else ZERO


def _par(pd: PeriodeData | None, cle, mesure) -> dict:
    out: dict = defaultdict(lambda: ZERO)
    for L in pd.lignes if pd else ():
        out[cle(L)] += mesure(pd, L)
    return out


def _cells(cur: PeriodeData, prev: PeriodeData | None, noms, cle, mesure) -> list[tuple]:
    a, b = _par(cur, cle, mesure), _par(prev, cle, mesure)
    return [(n, cell(a.get(n, ZERO), b.get(n, ZERO) if prev else None)) for n in noms]


def mensuel(cur: PeriodeData, prev: PeriodeData | None, refs: Refs, params: Params,
            budgets: Budgets | None = None) -> dict:
    budgets = budgets or Budgets()
    refs = _contrats_vus(refs, cur, prev)
    # CA et marge se saisissent à part : le mois précédent peut en avoir sans ligne de paie.
    ca1, marge1 = (prev.ca, prev.marge) if prev else (None, None)
    objectifs = _objectifs(cur, budgets, params)
    activite = _bloc_activite(_activite(cur), _activite(prev), cur.partiel, objectifs)
    prev = _ok(prev)
    ms, ms1 = cur.ms, prev.ms if prev else None
    eff, eff1 = len(cur.ids), len(prev.ids) if prev else None
    recrut = len(cur.ids - prev.ids) if prev else None
    departs = len(prev.ids - cur.ids) if prev else None
    absences = cur.rubrique(ABSENCES)
    bud = f.budget(eff, params.budget_employe)
    ecart, ecart_pct = f.ecart_budget(ms, bud)
    exclus = sum((cur.rubrique(r) for r in cur.exclues if r != ABSENCES), ZERO)

    synthese = {
        "ms": {**cell(ms, ms1), "budget": bud, "ecart": ecart, "ecart_pct": ecart_pct},
        "effectif": {
            "debut": eff1, "recrutements": recrut, "departs": departs, "fin": eff,
            "variation": f.variation(Decimal(eff), None if eff1 is None else Decimal(eff1)),
        },
        "taux_rotation": f.taux_rotation(recrut or 0, departs or 0, eff1, eff) if prev else None,
        "absences": cell(absences, prev.rubrique(ABSENCES) if prev else None),
        "taux_absenteisme": f.taux_absenteisme(absences, eff, params.jours_ouvres),
        "ca": cur.ca,
        "marge": cur.marge,
        "taux_marge": f.taux_marge(cur.ca, cur.marge),
        "exclus": exclus,
        "remuneration_globale": ms + exclus,
        "commissions": cell(cur.rubrique(COMMISSION), prev.rubrique(COMMISSION) if prev else None),
        "primes_total": cell(sum((cur.rubrique(r) for r in PRIMES), ZERO),
                             sum((prev.rubrique(r) for r in PRIMES), ZERO) if prev else None),
        "salaire": cell(cur.rubrique(SALAIRE), prev.rubrique(SALAIRE) if prev else None),
        "primes_toutes": cell(sum((cur.rubrique(r) for r in PRIMES_TOUTES), ZERO),
                              sum((prev.rubrique(r) for r in PRIMES_TOUTES), ZERO)
                              if prev else None),
        "primes": [
            {"rubrique": r, **cell(cur.rubrique(r), prev.rubrique(r) if prev else None)}
            for r in PRIMES
        ],
    }

    def mont(rub):
        return lambda pd, L: L.montants.get(rub, ZERO)

    a_type = [
        {"rubrique": r, "exclu": r in cur.exclues,
         **cell(cur.rubrique(r), prev.rubrique(r) if prev else None),
         **_bud(cur.rubrique(r), budgets.rubrique.get(r))}
        for r in refs.rubriques if r != ABSENCES
    ]
    # chemin indépendant de PeriodeData.ms : somme des rubriques comptées dans le total
    parts = {x["rubrique"]: (_part(cur, x["rubrique"], True), _part(prev, x["rubrique"], True))
             for x in a_type}
    ms_a = sum((p[0] for p in parts.values()), ZERO)
    ms_a1 = sum((p[1] for p in parts.values()), ZERO) if prev else None

    def total(pd, L):
        return pd.total(L)

    b_service = []
    for s in refs.services:
        sub = PeriodeData(tuple(L for L in cur.lignes if L.service == s), cur.exclues)
        sub1 = PeriodeData(tuple(L for L in prev.lignes if L.service == s), prev.exclues) \
            if prev else None
        b_service.append({
            "service": s,
            "total": {**cell(sub.ms, sub1.ms if sub1 else None),
                      **_bud(sub.ms, budgets.service.get(s))},
            "effectif": cell(Decimal(len(sub.ids)), Decimal(len(sub1.ids)) if sub1 else None),
            "activites": [
                {"activite": n, **c, "effectif": cell(
                    Decimal(len({L.salarie_id for L in sub.lignes if L.activite == n})),
                    Decimal(len({L.salarie_id for L in sub1.lignes if L.activite == n}))
                    if sub1 else None)}
                for n, c in _cells(sub, sub1, refs.activites, lambda L: L.activite, total)],
            "ms_contrat": dict(_cells(sub, sub1, refs.contrats, lambda L: L.contrat, total)),
            "effectif_contrat": {c: cell(
                Decimal(len({L.salarie_id for L in sub.lignes if L.contrat == c})),
                Decimal(len({L.salarie_id for L in sub1.lignes if L.contrat == c}))
                if sub1 else None) for c in refs.contrats},
        })
    ms_services = sum((b["total"]["m"] for b in b_service), ZERO)

    sites_ms = dict(_cells(cur, prev, refs.sites, lambda L: L.site, total))
    sites_eff = {s: (len({L.salarie_id for L in cur.lignes if L.site == s}),
                     len({L.salarie_id for L in prev.lignes if L.site == s}) if prev else None)
                 for s in refs.sites}

    def eff_site_contrat(pd, s, c):
        if not pd:
            return None
        return len({L.salarie_id for L in pd.lignes if L.site == s and L.contrat == c})

    def cell_eff(m, m1):
        return cell(None if m is None else Decimal(m), None if m1 is None else Decimal(m1))

    def ms_site_contrat(pd, s, c):
        if not pd:
            return None
        return sum((pd.total(L) for L in pd.lignes if L.site == s and L.contrat == c), ZERO)

    c_site = [{"site": s, "ms": {**sites_ms[s], **_bud(sites_ms[s]["m"], budgets.site.get(s))},
               "effectif": cell_eff(*sites_eff[s]),
               "effectif_contrat": {c: cell_eff(eff_site_contrat(cur, s, c),
                                                eff_site_contrat(prev, s, c))
                                    for c in refs.contrats},
               "ms_contrat": {c: cell(ms_site_contrat(cur, s, c), ms_site_contrat(prev, s, c))
                              for c in refs.contrats}} for s in refs.sites]
    ms_sites = sum((c["ms"]["m"] for c in c_site), ZERO)
    c_site_total = {"ms": _somme([c["ms"] for c in c_site], budget=True),
                    "effectif": _somme([c["effectif"] for c in c_site])}

    ctrl_contrats: list[dict] = []

    def eff_contrat(pd, contrat):
        return len({L.salarie_id for L in pd.lignes if L.contrat == contrat}) if pd else None

    d_eff = [{"contrat": c, **cell(Decimal(eff_contrat(cur, c)),
                                   None if prev is None else Decimal(eff_contrat(prev, c)))}
             for c in refs.contrats]
    total_contrats = sum((d["m"] for d in d_eff), ZERO)
    def ventil(pd, c, a):
        sel = [L for L in pd.lignes if L.contrat == c and L.activite == a] if pd else []
        return (sum((pd.total(L) for L in sel), ZERO), Decimal(len({L.salarie_id for L in sel}))
                ) if pd else (None, None)

    ventilation = []
    for c in refs.contrats:
        for a in refs.activites:
            (ms_c, ef_c), (ms_c1, ef_c1) = ventil(cur, c, a), ventil(prev, c, a)
            ventilation.append({"contrat": c, "activite": a, "ms": cell(ms_c, ms_c1),
                                "effectif": cell(ef_c, ef_c1)})

    def indicateurs(contrat: str | None) -> dict:
        def sel(pd):
            if pd is None:
                return None
            lignes = tuple(L for L in pd.lignes if contrat is None or L.contrat == contrat)
            return PeriodeData(lignes, pd.exclues)
        c, p = sel(cur), sel(prev)
        ids, ids1 = c.ids, (p.ids if p else None)
        rec = len(ids - ids1) if p else None
        dep = len(ids1 - ids) if p else None
        abs_ = c.rubrique(ABSENCES)
        return {
            "contrat": contrat or "TOTAL",
            "debut": len(ids1) if p else None, "recrutements": rec, "departs": dep,
            "fin": len(ids),
            "taux_rotation": (
                f.taux_rotation(rec or 0, dep or 0, len(ids1), len(ids)) if p else None),
            "absences": abs_,
            "taux_absenteisme": f.taux_absenteisme(abs_, len(ids), params.jours_ouvres),
        }

    d_indic = [indicateurs(c) for c in refs.contrats] + [indicateurs(None)]
    for champ in ("debut", "fin"):  # flux non additifs si changement de contrat
        vals = [d[champ] for d in d_indic[:-1]]
        if None not in vals:
            controles_extra = _controle(f"Total contrats = somme ({champ})",
                                        Decimal(sum(vals)), Decimal(d_indic[-1][champ]))
            ctrl_contrats.append(controles_extra)

    controles = [
        _controle("MS type de charge = service = site", ms_a, ms_services, ms_sites, ms),
        _controle("Total contrats = somme des types", total_contrats, Decimal(eff)),
    ]
    controles.extend(ctrl_contrats)
    if eff1 is not None:
        controles.append(_controle("Effectif fin = début + recrutements − départs",
                                   Decimal(eff1 + recrut - departs), Decimal(eff)))
    return {
        "synthese": synthese,
        "lignes_ca_marge": {
            "ca": _avec_objectif(_avec_partiel(cell(cur.ca, ca1), "ca" in cur.partiel),
                                 "ca", objectifs["ca"], cur.partiel),
            "marge": _avec_objectif(_avec_partiel(cell(cur.marge, marge1), "marge" in cur.partiel),
                                    "marge", objectifs["marge"], cur.partiel)},
        "frais_mission": {
            **cell(cur.rubrique(FRAIS_MISSION), prev.rubrique(FRAIS_MISSION) if prev else None),
            **_bud(cur.rubrique(FRAIS_MISSION), objectifs["frais_mission"])},
        "objectifs": objectifs,
        "budget_partiel": _budget_partiel(cur.partiel),
        "activite": activite,
        "a_type_charge": a_type
        + [{"rubrique": "TOTAL CHARGES", "exclu": False, **cell(ms_a, ms_a1),
            **_bud(ms_a, bud)}],
        "b_service_activite": b_service,
        "c_site": c_site,
        "c_site_total": c_site_total,
        "d_contrat": {"effectifs": d_eff, "indicateurs": d_indic,
                      "total": cell(Decimal(eff), None if eff1 is None else Decimal(eff1)),
                      "ventilation": ventilation},
        "controles": controles,
    }


def _controle(libelle: str, *valeurs: Decimal) -> dict:
    ecart = f.ecart_bloquant(*valeurs)
    return {"controle": libelle, "ecart": ecart, "bloquant": ecart > f.TOLERANCE}


def avec_donnees(pds: dict[int, PeriodeData], jusqu_au: int = 12) -> list[int]:
    return [m for m in sorted(pds) if m <= jusqu_au and _ok(pds[m])]


def _blocs_annuels(n, ok, n1, ok1, refs: Refs, params: Params,
                   budgets: dict[int, Budgets]) -> dict:
    """Blocs A à D de l'onglet ANNUEL : cumul des mois saisis jusqu'au mois choisi (N contre N-1).
    Les effectifs sont des moyennes mensuelles sur ces mois (note de l'Excel)."""
    nb = len(ok)

    def cum(pds, mois_ok, mesure) -> Decimal | None:
        return sum((mesure(pds[m]) for m in mois_ok), ZERO) if mois_ok else None

    def moy_eff(pds, mois_ok, pred) -> Decimal | None:
        if not mois_ok:
            return None
        tot = sum(len({L.salarie_id for L in pds[m].lignes if pred(L)}) for m in mois_ok)
        return Decimal(tot) / len(mois_ok)

    def cell_ms(pred) -> dict:
        return cell(cum(n, ok, lambda pd: sum((pd.total(L) for L in pd.lignes if pred(L)), ZERO)),
                    cum(n1, ok1, lambda pd: sum((pd.total(L) for L in pd.lignes if pred(L)), ZERO)))

    def cell_eff(pred) -> dict:
        return cell(moy_eff(n, ok, pred), moy_eff(n1, ok1, pred))

    def bud(axe: str, cle: str, reel: Decimal | None) -> dict:
        vals = [getattr(budgets[m], axe).get(cle) for m in ok if m in budgets]
        vals = [v for v in vals if v is not None]
        return _bud(reel, sum(vals, ZERO) if vals else None)

    exclues = n[ok[-1]].exclues if ok else frozenset()
    a_type = [
        {"rubrique": r, "exclu": r in exclues,
         **cell(cum(n, ok, lambda pd, r=r: pd.rubrique(r)),
                cum(n1, ok1, lambda pd, r=r: pd.rubrique(r))),
         **bud("rubrique", r, cum(n, ok, lambda pd, r=r: pd.rubrique(r)))}
        for r in refs.rubriques if r != ABSENCES
    ]
    ms_n, ms_n1 = cum(n, ok, lambda pd: pd.ms), cum(n1, ok1, lambda pd: pd.ms)
    a_type.append({"rubrique": "TOTAL CHARGES", "exclu": False,
                   **cell(ms_n, ms_n1),
                   **bud("rubrique", "TOTAL CHARGES", ms_n)})

    b_service = []
    for s in refs.services:
        tot = cell_ms(lambda L, s=s: L.service == s)
        b_service.append({
            "service": s,
            "total": {**tot, **bud("service", s, tot["m"])},
            "effectif": cell_eff(lambda L, s=s: L.service == s),
            "activites": [
                {"activite": a, **cell_ms(lambda L, s=s, a=a: L.service == s and L.activite == a),
                 "effectif": cell_eff(lambda L, s=s, a=a: L.service == s and L.activite == a)}
                for a in refs.activites],
            "ms_contrat": {c: cell_ms(lambda L, s=s, c=c: L.service == s and L.contrat == c)
                           for c in refs.contrats},
            "effectif_contrat": {c: cell_eff(lambda L, s=s, c=c: L.service == s and L.contrat == c)
                                 for c in refs.contrats},
        })

    c_site = []
    for s in refs.sites:
        ms = cell_ms(lambda L, s=s: L.site == s)
        e = cell_eff(lambda L, s=s: L.site == s)
        par_contrat = {c: cell_eff(lambda L, s=s, c=c: L.site == s and L.contrat == c)
                       for c in refs.contrats}
        c_site.append({"site": s, "ms": {**ms, **bud("site", s, ms["m"])},
                       "effectif": e,
                       "effectif_contrat": par_contrat,
                       "ms_contrat": {c: cell_ms(lambda L, s=s, c=c: L.site == s and L.contrat == c)
                                      for c in refs.contrats}})

    def fin_an(pds, mois_ok, contrat) -> int | None:
        if not mois_ok:
            return None
        return len({L.salarie_id for L in pds[mois_ok[-1]].lignes
                    if contrat is None or L.contrat == contrat})

    def indicateurs(contrat: str | None) -> dict:
        def ids(pds, mois_ok):
            return {L.salarie_id for m in mois_ok for L in pds[m].lignes
                    if contrat is None or L.contrat == contrat}
        c, p = ids(n, ok), (ids(n1, ok1) if ok1 else None)
        rec = len(c - p) if p is not None else None
        dep = len(p - c) if p is not None else None
        fin, debut = fin_an(n, ok, contrat), fin_an(n1, ok1, contrat)
        abs_ = cum(n, ok, lambda pd: sum(
            (L.montants.get(ABSENCES, ZERO) for L in pd.lignes
             if contrat is None or L.contrat == contrat), ZERO)) or ZERO
        return {
            "contrat": contrat or "TOTAL", "debut": debut, "recrutements": rec, "departs": dep,
            "fin": fin or 0,
            "taux_rotation": (f.taux_rotation(rec or 0, dep or 0, debut, fin or 0)
                              if p is not None else None),
            "absences": abs_,
            "taux_absenteisme": (f.taux_absenteisme(abs_, (fin or 0) * nb, params.jours_ouvres)
                                 if nb else None),
        }

    d_indic = [indicateurs(c) for c in refs.contrats] + [indicateurs(None)]
    ventilation = [
        {"contrat": c, "activite": a,
         "ms": cell_ms(lambda L, c=c, a=a: L.contrat == c and L.activite == a),
         "effectif": cell_eff(lambda L, c=c, a=a: L.contrat == c and L.activite == a)}
        for c in refs.contrats for a in refs.activites]
    return {
        "a_type_charge": a_type,
        "b_service_activite": b_service,
        "c_site": c_site,
        "c_site_total": {"ms": _somme([c["ms"] for c in c_site], budget=True),
                         "effectif": _somme([c["effectif"] for c in c_site])},
        "d_contrat": {"indicateurs": d_indic, "ventilation": ventilation,
                      "effectifs": [{"contrat": c, **cell_eff(lambda L, c=c: L.contrat == c)}
                                    for c in refs.contrats],
                      "total": cell_eff(lambda L: True)},
        "effectif_global": cell_eff(lambda L: True),
        "nb_mois_absences": nb,
    }


def annuel(
    n: dict[int, PeriodeData], n1: dict[int, PeriodeData], mois: int, refs: Refs, params: Params,
    budgets: dict[int, Budgets] | None = None, params_mois: dict[int, Params] | None = None,
) -> dict:
    """n, n1 : mois -> données de l'année N et N-1. `mois` : dernier mois du cumul. `budgets` et
    `params_mois` : budgets et paramètres de chaque mois de N (série des objectifs ; `params` à
    défaut)."""
    refs = _contrats_vus(refs, *n.values(), *n1.values())
    def remuneration(pd: PeriodeData) -> Decimal:
        # comme `remuneration_globale` du mensuel : TOTAL CHARGES + exclusions hors absences
        return pd.ms + sum((pd.rubrique(r) for r in pd.exclues if r != ABSENCES), ZERO)

    def par_contrat(pd: PeriodeData) -> dict[str, int]:
        return {c: len({L.salarie_id for L in pd.lignes if L.contrat == c}) for c in refs.contrats}

    def paie(pd: PeriodeData) -> dict:
        # séries tirées de la paie, toutes vides ensemble sur un mois sans données
        return {
            "ms": pd.ms,
            "effectif": len(pd.ids),
            "absences": pd.rubrique(ABSENCES),
            "commissions": pd.rubrique(COMMISSION),
            "primes": sum((pd.rubrique(r) for r in PRIMES), ZERO),
            "salaire": pd.rubrique(SALAIRE),
            "primes_toutes": sum((pd.rubrique(r) for r in PRIMES_TOUTES), ZERO),
            "frais_mission": pd.rubrique(FRAIS_MISSION),
            "logement": pd.rubrique(LOGEMENT),
            "assurance": pd.rubrique(ASSURANCE),
            "formation": pd.rubrique(FORMATION),
            "carburant": pd.rubrique(CARBURANT),
            "credit_telephonique": pd.rubrique(CREDIT_TEL),
            "remuneration": remuneration(pd),
            "effectif_contrat": par_contrat(pd),
        }

    cles_paie = tuple(paie(PeriodeData(())))

    def serie(pds, objectifs=None):
        return [{"mois": m,
                 **(paie(pd) if (pd := _ok(pds.get(m))) else dict.fromkeys(cles_paie)),
                 # saisies indépendantes de la paie : un mois peut avoir un CA sans lignes
                 **_ca_marge(pds.get(m)),
                 "activite": _activite(pds.get(m)),
                 **({"objectifs": objectifs[m]} if objectifs is not None else {})}
                for m in range(1, 13)]

    def cumul(pds):
        mois_ok = avec_donnees(pds, mois)
        c = sum((pds[m].ms for m in mois_ok), ZERO)
        return c, len(mois_ok), f.moyenne(c, len(mois_ok)), mois_ok

    c, nb, moy, ok = cumul(n)
    c1, nb1, moy1, _ = cumul(n1)
    avec_ca = [m for m in sorted(n) if m <= mois and n[m].ca is not None]
    avec_marge = [m for m in avec_ca if n[m].marge is not None]
    ca_ytd = sum((n[m].ca for m in avec_ca), ZERO) if avec_ca else None
    marge_ytd = sum((n[m].marge for m in avec_marge), ZERO) if avec_marge else None
    # taux sur les seuls mois où CA et marge sont saisis
    ca_avec_marge = sum((n[m].ca for m in avec_marge), ZERO) if avec_marge else None
    commissions_ytd = sum((n[m].rubrique(COMMISSION) for m in ok), ZERO) if nb else None
    primes_ytd = sum((n[m].rubrique(r) for m in ok for r in PRIMES), ZERO) if nb else None

    def ms_service(pds, mois_ok):
        out = defaultdict(lambda: ZERO)
        for m in mois_ok:
            for L in pds[m].lignes:
                out[L.service] += pds[m].total(L)
        return out

    ok1 = avec_donnees(n1, mois)
    s_n = ms_service(n, ok)
    s_n1 = ms_service(n1, ok1)
    complet1 = sum((n1[m].ms for m in avec_donnees(n1)), ZERO)
    blocs = _blocs_annuels(n, ok, n1, ok1, refs, params, budgets or {})
    objectifs_n = {m: _objectifs(n.get(m), (budgets or {}).get(m, Budgets()),
                                 (params_mois or {}).get(m, params)) for m in range(1, 13)}

    manque: set[str] = set()

    def objectif_cumul(cle: str, mois_reels) -> Decimal | None:
        """Objectif sur les mêmes mois que le réel (moyenne des mois pour la productivité) ; un
        mois de réel sans objectif rend l'objectif partiel."""
        mois_reels = list(mois_reels)
        vals = [objectifs_n[m][cle] for m in mois_reels if objectifs_n[m][cle] is not None]
        if vals and len(vals) < len(mois_reels):
            manque.add(OBJECTIF[cle])
        return (_moyenne_opt if cle == "productivite" else _somme_opt)(vals)

    def budget_cumul(nom: str) -> Decimal | None:
        return _somme_opt(b for m in ok if m in (budgets or {})
                          for b in [budgets[m].rubrique.get(nom)] if b is not None)

    activite_n = {m: _activite(n[m]) for m in n if m <= mois}
    objectifs_activite = {k: objectif_cumul(k, [m for m, a in activite_n.items()
                                                 if a[k] is not None])
                          for k in OBJECTIFS_ACTIVITE}
    # Résumé : cumuls N-1 sur la même période, part des MAD et CA par effectif moyen global
    # (docs/QUESTIONS_CLIENT.md C1, C3).
    avec_ca1 = [m for m in sorted(n1) if m <= mois and n1[m].ca is not None]
    ca1 = sum((n1[m].ca for m in avec_ca1), ZERO) if avec_ca1 else None
    avec_marge1 = [m for m in avec_ca1 if n1[m].marge is not None]
    marge1 = sum((n1[m].marge for m in avec_marge1), ZERO) if avec_marge1 else None
    eff = blocs["effectif_global"]
    partiel_n = frozenset().union(*(n[m].partiel for m in n if m <= mois))
    obj_ca, obj_marge = objectif_cumul("ca", avec_ca), objectif_cumul("marge", avec_marge)
    partiel_obj = partiel_n | manque  # réel incomplet ou mois de réel sans objectif

    def ratio(a: Decimal | None, b: Decimal | None) -> Decimal | None:
        return None if a is None or not b else a / b

    # Résumé : effectif de fin = dernier mois saisi, comparé au même mois N-1 (retours du 16/10).
    der = ok[-1] if ok else None
    fin, fin1 = (n[der] if der else None), (_ok(n1.get(der)) if der else None)

    def eff_fin(pred) -> dict:
        def compte(pd):
            return Decimal(len({L.salarie_id for L in pd.lignes if pred(L)})) if pd else None
        return cell(compte(fin), compte(fin1))

    def avec_part(c: dict, total: dict) -> dict:
        return {**c, "part": ratio(c["m"], total["m"])}

    eff_fin_total = eff_fin(lambda L: True)
    mad_fin = eff_fin(lambda L: L.contrat == "MAD")
    ms_total = {"m": c if nb else None}

    def ms_contrat(pds, mois_ok, contrat) -> Decimal | None:
        return sum((pds[m].total(L) for m in mois_ok for L in pds[m].lignes
                    if L.contrat == contrat), ZERO) if mois_ok else None

    def cumul_rub(nom: str) -> Decimal | None:
        return sum((n[m].rubrique(nom) for m in ok), ZERO) if nb else None

    return {
        **blocs,
        "serie_n": serie(n, objectifs_n),
        "serie_n1": serie(n1),
        "cumul_ytd": {**cell(c if nb else None, c1 if nb1 else None), "nb_mois": nb,
                      "nb_mois_n1": nb1},
        "moyenne_mensuelle": cell(moy, moy1),
        "marge_ytd": marge_ytd,
        "nb_mois_marge": len(avec_marge),
        "nb_mois_ca": len(avec_ca),
        "ca_ytd": ca_ytd,
        "taux_marge_ytd": f.taux_marge(ca_avec_marge, marge_ytd),
        "ca_avec_marge": ca_avec_marge,
        "commissions_ytd": commissions_ytd,
        "primes_ytd": primes_ytd,
        "ca_cumul": cell(ca_ytd, ca1),
        "lignes_ca_marge": {
            "ca": _avec_objectif(_avec_partiel(cell(ca_ytd, ca1), "ca" in partiel_n), "ca",
                                 obj_ca, partiel_obj),
            "marge": _avec_objectif(_avec_partiel(cell(marge_ytd, marge1), "marge" in partiel_n),
                                    "marge", obj_marge, partiel_obj)},
        "frais_mission": {
            **cell(cumul_rub(FRAIS_MISSION),
                   sum((n1[m].rubrique(FRAIS_MISSION) for m in ok1), ZERO) if ok1 else None),
            **_bud(cumul_rub(FRAIS_MISSION), budget_cumul(FRAIS_MISSION))},
        "budget_partiel": _budget_partiel(partiel_obj),
        "activite": _bloc_activite(_activite_cumul(n, mois), _activite_cumul(n1, mois), partiel_obj,
                                   objectifs_activite),
        "commissions_cumul": cell(commissions_ytd,
                                  sum((n1[m].rubrique(COMMISSION) for m in ok1), ZERO)
                                  if ok1 else None),
        "primes_cumul": cell(primes_ytd, sum((n1[m].rubrique(r) for m in ok1 for r in PRIMES), ZERO)
                             if ok1 else None),
        "salaire_cumul": cell(cumul_rub(SALAIRE),
                              sum((n1[m].rubrique(SALAIRE) for m in ok1), ZERO) if ok1 else None),
        "primes_toutes_cumul": cell(
            sum((n[m].rubrique(r) for m in ok for r in PRIMES_TOUTES), ZERO) if nb else None,
            sum((n1[m].rubrique(r) for m in ok1 for r in PRIMES_TOUTES), ZERO) if ok1 else None),
        "frais_mission_ytd": cumul_rub(FRAIS_MISSION),
        "logement_ytd": cumul_rub(LOGEMENT),
        "effectif_moyen": eff,
        "mois_fin": der,
        "effectif_fin": eff_fin_total,
        "effectif_fin_contrat": {ct: avec_part(eff_fin(lambda L, ct=ct: L.contrat == ct),
                                               eff_fin_total) for ct in refs.contrats},
        # MAD affectés aux sites déportés, part des MAD globaux (effectif de fin)
        "mad_fin": mad_fin,
        "mad_deportes_fin": avec_part(
            eff_fin(lambda L: L.contrat == "MAD" and L.type_site == "deporte"), mad_fin),
        "ms_contrat": {ct: avec_part(cell(ms_contrat(n, ok, ct), ms_contrat(n1, ok1, ct)),
                                     ms_total) for ct in refs.contrats},
        "ca_par_effectif": cell(ratio(ca_ytd, eff["m"]), ratio(ca1, eff["m1"])),
        "cumul_annee_n1": complet1 if avec_donnees(n1) else None,
        "par_service": [
            {"service": s, **cell(s_n.get(s, ZERO) if nb else None,
                                  s_n1.get(s, ZERO) if nb1 else None),
             "nb_mois": nb, "nb_mois_n1": nb1,
             "moy_m": f.moyenne(s_n.get(s, ZERO), nb),
             "moy_m1": f.moyenne(s_n1.get(s, ZERO), nb1),
             "ecart_moy_pct": f.variation_pct(f.moyenne(s_n.get(s, ZERO), nb),
                                              f.moyenne(s_n1.get(s, ZERO), nb1))}
            for s in refs.services],
    }


def individuel(pds: dict[int, PeriodeData], salarie_id: int, refs: Refs) -> dict:
    """Un matricule sur 12 mois. Mois sans ligne : None."""
    mois = []
    for m in range(1, 13):
        pd = _ok(pds.get(m))
        ligne = next((L for L in pd.lignes if L.salarie_id == salarie_id), None) if pd else None
        mois.append({
            "mois": m,
            "present": ligne is not None,
            "service": ligne.service if ligne else None,
            "site": ligne.site if ligne else None,
            "contrat": ligne.contrat if ligne else None,
            "rubriques": {r: ligne.montants.get(r) for r in refs.rubriques} if ligne else None,
            "total": pd.total(ligne) if ligne and pd else None,
            "activite": {
                k: ligne.indicateurs.get(nom) for k, nom in (
                    ("ventes", VENTES), ("clients", CLIENTS), ("productivite", PRODUCTIVITE),
                    ("ca_individuel", CA_INDIVIDUEL), ("marge_individuelle", MARGE_INDIVIDUELLE))
            } if ligne else None,
            "reference": ligne.reference if ligne else None,
        })
    presents = [x["total"] for x in mois if x["present"]]
    cumul = sum(presents, ZERO)
    return {"mois": mois, "cumul": cumul, "nb_mois": len(presents),
            "moyenne": f.moyenne(cumul, len(presents)),
            "activite_total": activite_total([x["activite"] for x in mois])}


def activite_total(activites: list[dict | None]) -> dict:
    """Total de l'année des indicateurs d'activité mensuels : productivité en moyenne des mois
    renseignés, le reste additionné ; None si aucun mois n'est renseigné."""
    out = {}
    for k in ("ventes", "clients", "productivite", "ca_individuel", "marge_individuelle"):
        vals = [a[k] for a in activites if a and a.get(k) is not None]
        out[k] = (None if not vals else f.moyenne(sum(vals, ZERO), len(vals))
                  if k == "productivite" else sum(vals, ZERO))
    return out
