"""Répartition des charges (docs/etude-repartition-charges.md, maquette charges.html).

Logique pure, sans base ni HTTP : l'entrée est la liste des mois de la période (N) et celle des
mois comparés (N-1), un `PeriodeData` par mois (None ou vide : mois sans donnée). Les montants sont
des `Decimal`.

Le TOTAL CHARGES est celui du rapport. Chaque axe (type de charge, site, service, activité,
contrat) découpe ce même total : la somme de ses lignes égale le total. L'axe type de charge
montre une ligne par rubrique de paie comptée dans le total à la date de chaque mois
(`pd.exclues`). Seuls les mois de N qui ont des données comptent, avec leur correspondant de N-1.
"""

from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from decimal import Decimal
from itertools import zip_longest

from app.kpi.moteur import ABSENCES, ZERO, Budgets, Ligne, PeriodeData, cell

# Rubriques de la famille « Primes » (QUESTIONS_CLIENT F5) : sur un mois seul comparé au mois
# d'avant, elles se comparent au même mois un an plus tôt (étude §7, « Période »).
RUBRIQUES_PRIMES: tuple[str, ...] = (
    "Bonus", "Primes exceptionnelles", "Primes sur ventes", "Primes sur résultats",
    "Productivité Ateliers", "Commission")

# Axes de découpage du total : clé de l'API -> attribut de la ligne (None : rubriques à plat).
AXES: dict[str, str | None] = {"type": None, "site": "site", "service": "service",
                               "activite": "activite", "contrat": "contrat"}
# Axes dont chaque ligne se détaille par activité (Front office / Back office).
AXES_AVEC_ENFANTS = ("type", "site", "service", "contrat")

# Le budget n'est saisi qu'à partir de janvier 2025 (indice de mois : année * 12 + mois - 1).
BUD_DEBUT = 2025 * 12


@dataclass(frozen=True)
class Contexte:
    """Ce qui décide de l'affichage du budget : début de la période (indice de mois) et filtres
    actifs. `perimetre` : compte à périmètre restreint ; `perim_service` et `perim_site` : le
    périmètre du compte restreint les services ou les sites ; `departement` : filtre Département
    choisi dans la barre (distinct du périmètre du compte)."""

    debut: int
    service: bool = False
    site: bool = False
    activite: bool = False
    contrat: bool = False
    poste: bool = False
    perimetre: bool = False
    perim_service: bool = False
    perim_site: bool = False
    departement: bool = False


def raison_budget(ctx: Contexte | None, axe: str) -> str | None:
    """Pourquoi l'axe n'a pas de budget (None : il peut en avoir). Mêmes règles que le serveur de
    budgets (`chargement.charger_budgets`) : tests dans l'ordre de la maquette."""
    if ctx is None:
        return None
    if ctx.debut < BUD_DEBUT:
        return "Budget saisi à partir de janv. 2025 : la période choisie commence avant."
    if axe == "activite":
        return "Budget non suivi par activité."
    if axe == "contrat":
        return "Budget non suivi par nature de contrat."
    if ctx.poste:
        return "Budget non suivi par poste ni par personne."
    ac = ctx.activite or ctx.contrat
    if axe == "type" and (ctx.departement or ctx.service or ctx.site or ctx.perimetre or ac):
        dep = "Département, " if ctx.departement else ""
        return ("Budget par type de charge saisi pour toute l'entreprise : masqué avec un filtre "
                f"{dep}Service, Site, Activité ou Contrat, ou pour un compte à périmètre.")
    if axe == "site" and (ctx.departement or ctx.service or ctx.perim_service or ac):
        dep = "département, " if ctx.departement else ""
        return (f"Budget par site non découpé par {dep}service, activité ni contrat : retirer ces "
                "filtres pour le voir.")
    if axe == "service" and (ctx.site or ctx.perim_site or ac):
        return ("Budget par service non découpé par site, activité ni contrat : retirer ces "
                "filtres pour le voir.")
    return None


def rubriques_connues(paie: Sequence[str], pds: Sequence[PeriodeData | None]) -> list[str]:
    """Rubriques à répartir : toutes celles de paie (actives ou non, dans l'ordre du référentiel),
    puis celles que les données portent sans figurer au référentiel. Les absences (des jours) et
    les rubriques d'activité (hors montants) n'en font jamais partie. Ainsi la somme des lignes de
    l'axe type égale toujours le total, qui compte tout montant non exclu."""
    vues = {r for pd in pds if pd is not None for L in pd.lignes for r in L.montants}
    base = [r for r in paie if r != ABSENCES]
    return base + sorted(r for r in vues if r not in set(base) and r != ABSENCES)


def _a_donnees(pd: PeriodeData | None) -> bool:
    return pd is not None and bool(pd.lignes)


def _appaires(n: Sequence[PeriodeData | None], n1: Sequence[PeriodeData | None]
              ) -> tuple[list[PeriodeData], list[PeriodeData], bool]:
    """Mois de N qui ont des données, mois de N-1 correspondants (même rang, avec des données
    des deux côtés) et `partiel` : un mois de N avec données n'a pas son correspondant dans la
    comparaison, ou l'inverse (sans aucun mois comparé, la comparaison est absente, non
    partielle)."""
    paires = list(zip_longest(n, n1))
    mois_n = [a for a, _ in paires if a is not None and _a_donnees(a)]
    mois_n1 = [b for a, b in paires if b is not None and _a_donnees(a) and _a_donnees(b)]
    partiel = bool(mois_n1) and any(_a_donnees(a) != _a_donnees(b) for a, b in paires)
    return mois_n, mois_n1, partiel


def _somme(pds: list[PeriodeData], mesure: Callable[[PeriodeData], Decimal]) -> Decimal | None:
    """Cumul d'une mesure sur les mois qui ont des données ; None sans aucun mois."""
    return sum((mesure(pd) for pd in pds), ZERO) if pds else None


# Montant d'une ligne de paie sur un mois, et filtre de lignes : de quoi découper le total.
Valeur = Callable[[PeriodeData, Ligne], Decimal]
Garde = Callable[[Ligne], bool]


def _valeur_total(pd: PeriodeData, L: Ligne) -> Decimal:
    return pd.total(L)


def _valeur_rubrique(rubrique: str) -> Valeur:
    def valeur(pd: PeriodeData, L: Ligne) -> Decimal:
        return ZERO if rubrique in pd.exclues else L.montants.get(rubrique, ZERO)
    return valeur


def _par_personne(pds: list[PeriodeData], valeur: Valeur, garde: Garde) -> dict[int, Decimal]:
    """Montant compté de chaque salarié sur les mois, pour les lignes retenues."""
    out: dict[int, Decimal] = defaultdict(lambda: ZERO)
    for pd in pds:
        for L in pd.lignes:
            if garde(L):
                out[L.salarie_id] += valeur(pd, L)
    return out


def _payes(montants: dict[int, Decimal]) -> set[int]:
    """Personnes payées : montant compté non nul."""
    return {s for s, v in montants.items() if v != 0}


def _tout(_: Ligne) -> bool:
    return True


def _somme_budget(bud: list[Budgets], lire: Callable[[Budgets], Decimal | None]) -> Decimal | None:
    """Budget cumulé sur les mois de la période (un mois sans budget saisi ne compte pas) ;
    None si aucun mois n'en a."""
    vals = [v for b in bud if (v := lire(b)) is not None]
    return sum(vals, ZERO) if vals else None


def _valeurs(pds: list[PeriodeData], attr: str, garde: Garde) -> list[str]:
    """Valeurs de l'attribut présentes dans les lignes retenues, dans l'ordre de première vue."""
    vues: dict[str, None] = {}
    for pd in pds:
        for L in pd.lignes:
            if garde(L):
                vues.setdefault(getattr(L, attr), None)
    return list(vues)


def _var_effectif(eff: int, eff1: int | None) -> tuple[int | None, Decimal | str | None]:
    """Écart d'effectif et sa variation en %, calculés avec la formule du moteur (Decimal)."""
    if eff1 is None:
        return None, None
    return eff - eff1, cell(Decimal(eff), Decimal(eff1))["var_pct"]


def _ligne(libelle: str, mois_n: list[PeriodeData], mois_n1: list[PeriodeData], valeur: Valeur,
           garde: Garde, base: Decimal | None, budget: Decimal | None = None) -> dict:
    """Ligne d'un axe : montants N et N-1, part de `base`, effectif payé (N, N-1) avec son écart,
    entrées (payées en N, pas en N-1), sorties (l'inverse), budget et réalisation du budget."""
    a = _par_personne(mois_n, valeur, garde)
    b = _par_personne(mois_n1, valeur, garde)
    m = sum(a.values(), ZERO)
    m1 = sum(b.values(), ZERO) if mois_n1 else None
    payes, payes1 = _payes(a), _payes(b)
    eff1 = len(payes1) if mois_n1 else None
    ecart, ecart_pct = _var_effectif(len(payes), eff1)
    return {"libelle": libelle, **cell(m, m1), "part": m / base if base else None,
            "effectif": len(payes), "effectif1": eff1,
            "effectif_var": ecart, "effectif_var_pct": ecart_pct,
            "entrees": len(payes - payes1) if mois_n1 else None,
            "sorties": len(payes1 - payes) if mois_n1 else None, "budget": budget,
            "ecart_budget": m - budget if budget else None,
            "realisation": m / budget if budget else None}


def _budget_total(lignes: list[dict], total: Decimal | None) -> dict | None:
    """Budget de l'axe (somme des lignes), écart et réalisation du total ; None dès qu'une ligne
    n'a pas de budget."""
    if total is None or not lignes or any(x["budget"] is None for x in lignes):
        return None
    budget = sum((x["budget"] for x in lignes), ZERO)
    return {"budget": budget, "ecart_budget": total - budget if budget else None,
            "realisation": total / budget if budget else None}


def _tri(lignes: list[dict]) -> list[dict]:
    """Lignes à montant (N ou N-1) non nul, par montant décroissant."""
    return sorted((x for x in lignes if x["m"] != 0 or x["m1"]),
                  key=lambda x: (-x["m"], x["libelle"]))


def _enfants(mois_n: list[PeriodeData], mois_n1: list[PeriodeData], valeur: Valeur,
             garde: Garde, parent: Decimal) -> list[dict]:
    """Détail d'une ligne par activité, part calculée sur la ligne parente."""
    acts = _valeurs([*mois_n, *mois_n1], "activite", garde)
    return _tri([_ligne(a, mois_n, mois_n1, valeur,
                        lambda L, a=a: garde(L) and L.activite == a, parent) for a in acts])


def _axe(cle: str, mois_n: list[PeriodeData], mois_n1: list[PeriodeData], rubriques: list[str],
         total: Decimal | None, bud: list[Budgets], bud_ok: bool,
         mois_n1_primes: list[PeriodeData] | None = None) -> list[dict]:
    """Lignes d'un axe, triées par montant décroissant (types de charge : ordre du référentiel),
    chacune détaillée par activité sauf l'axe activité. `mois_n1_primes` : mois comparés des
    rubriques de primes (axe type), quand ils diffèrent de la comparaison du reste."""
    attr = AXES[cle]
    tous = [*mois_n, *mois_n1]
    if attr is None:
        entrees = [(r, _valeur_rubrique(r), _tout,
                    _somme_budget(bud, lambda b, r=r: b.rubrique.get(r)) if bud_ok else None,
                    mois_n1_primes if mois_n1_primes is not None and r in RUBRIQUES_PRIMES
                    else mois_n1)
                   for r in rubriques]
    else:
        lire = {"site": lambda b: b.site, "service": lambda b: b.service}.get(cle)
        entrees = [(v, _valeur_total, lambda L, v=v, attr=attr: getattr(L, attr) == v,
                    _somme_budget(bud, lambda b, v=v: lire(b).get(v)) if bud_ok and lire else None,
                    mois_n1)
                   for v in _valeurs(tous, attr, _tout)]
    lignes = []
    for libelle, valeur, garde, budget, comparees in entrees:
        x = _ligne(libelle, mois_n, comparees, valeur, garde, total, budget)
        if x["m"] == 0 and not x["m1"]:
            continue
        if comparees is not mois_n1:
            x["cmp_primes"] = True
        if cle == "site":
            x["type_site"] = next(L.type_site for pd in tous for L in pd.lignes if garde(L))
        if cle in AXES_AVEC_ENFANTS:
            x["enfants"] = _enfants(mois_n, comparees, valeur, garde, x["m"])
        lignes.append(x)
    ordre = {r: i for i, r in enumerate(rubriques)}
    if attr is None:
        return sorted(lignes, key=lambda x: ordre[x["libelle"]])
    return _tri(lignes)


def rapport(n: Sequence[PeriodeData | None], n1: Sequence[PeriodeData | None],
            paie: Sequence[str], budgets: Sequence[Budgets | None] = (),
            ctx: Contexte | None = None,
            n1_primes: Sequence[PeriodeData | None] | None = None) -> dict:
    """Total des charges et axes de la période N comparée à N-1 (mêmes mois, même ordre). `paie` :
    rubriques de paie du référentiel, actives ou non. `budgets` : budgets mensuels de N, un par
    mois de `n` (None : aucun) ; `ctx` : début de la période et filtres (sans lui, aucun budget
    n'est affiché). `n1_primes` : mois de N un an plus tôt, pour comparer les rubriques de primes
    d'un mois seul (None : elles suivent N-1)."""
    mois_n, mois_n1, partiel = _appaires(n, n1)
    mois_n1_primes = None if n1_primes is None else _appaires(n, n1_primes)[1]
    total = cell(_somme(mois_n, lambda pd: pd.ms), _somme(mois_n1, lambda pd: pd.ms))
    rubriques = rubriques_connues(paie, (*mois_n, *mois_n1, *(mois_n1_primes or ())))
    bud = [b for b in budgets if b is not None]  # déjà limités aux mois qui ont des données
    bud_ok = ctx is not None and ctx.debut >= BUD_DEBUT
    a = _par_personne(mois_n, _valeur_total, _tout)
    b = _par_personne(mois_n1, _valeur_total, _tout)
    payes, payes1 = _payes(a), _payes(b)
    eff1 = len(payes1) if mois_n1 else None
    ecart, ecart_pct = _var_effectif(len(payes), eff1)
    # rubriques distinctes exclues du total sur la période, avec un montant non nul
    hors = {r for pd in mois_n for r in rubriques if r in pd.exclues and pd.rubrique(r) != 0}
    axes = {}
    for cle in AXES:
        lignes = _axe(cle, mois_n, mois_n1, rubriques, total["m"], bud, bud_ok, mois_n1_primes)
        axes[cle] = {"lignes": lignes, "budget_raison": raison_budget(ctx, cle),
                     "budget_total": _budget_total(lignes, total["m"])}
    return {
        "partiel": partiel,
        "total": total,
        "effectif": {"n": len(payes), "n1": eff1, "var": ecart, "var_pct": ecart_pct},
        "entrees": len(payes - payes1) if mois_n1 else None,
        "sorties": len(payes1 - payes) if mois_n1 else None,
        "hors_total": {"montant": sum((pd.rubrique(r) for pd in mois_n for r in rubriques
                                       if r in pd.exclues), ZERO),
                       "nb_rubriques": len(hors)},
        "axes": axes,
        "effectifs_contrat": [
            {**{k: x[v] for k, v in (("libelle", "libelle"), ("n", "effectif"),
                                     ("n1", "effectif1"), ("var", "effectif_var"),
                                     ("var_pct", "effectif_var_pct"), ("entrees", "entrees"),
                                     ("sorties", "sorties"))},
             "part": Decimal(x["effectif"]) / len(payes) if payes else None}
            for x in sorted(axes["contrat"]["lignes"], key=lambda x: (-x["effectif"], x["libelle"]))
            if x["effectif"] or x["effectif1"]],
    }


def personnes(n: Sequence[PeriodeData | None], n1: Sequence[PeriodeData | None],
              paie: Sequence[str], axe: str, valeur: str,
              activite: str | None = None,
              n1_primes: Sequence[PeriodeData | None] | None = None) -> list[dict] | None:
    """Salariés ayant un montant compté non nul, en N ou en N-1, sur la ligne `valeur` de l'axe
    (et son activité `activite` si elle est donnée) : lieu, activité, contrat et poste du dernier
    mois où ils figurent (N d'abord), montants N-1 et N, part de la ligne, entrée (payé en N, pas
    en N-1) ou sortie (l'inverse). Triés par montant N décroissant. `n1_primes` : comme pour
    `rapport`, comparaison des rubriques de primes. None : axe ou rubrique inconnus."""
    if axe not in AXES:
        return None
    mois_n, mois_n1, _ = _appaires(n, n1)
    primes = None if n1_primes is None else _appaires(n, n1_primes)[1]
    attr = AXES[axe]
    if attr is None:
        if valeur not in rubriques_connues(paie, (*mois_n, *mois_n1, *(primes or ()))):
            return None
        if primes is not None and valeur in RUBRIQUES_PRIMES:
            mois_n1 = primes
        mesure = _valeur_rubrique(valeur)
        base: Garde = _tout
    else:
        mesure = _valeur_total

        def base(L: Ligne) -> bool:
            return getattr(L, attr) == valeur

    def garde(L: Ligne) -> bool:
        return base(L) and (activite is None or L.activite == activite)

    a = _par_personne(mois_n, mesure, garde)
    b = _par_personne(mois_n1, mesure, garde)
    ligne = sum(a.values(), ZERO)
    fiche: dict[int, Ligne] = {}
    for pd in (*mois_n1, *mois_n):  # les mois de N écrasent ceux de N-1
        for L in pd.lignes:
            if garde(L):
                fiche[L.salarie_id] = L
    out = []
    for sid in set(a) | set(b):
        m, m1 = a.get(sid, ZERO), (b.get(sid, ZERO) if mois_n1 else None)
        if m == 0 and not m1:
            continue
        L = fiche[sid]
        out.append({"salarie_id": sid, "service": L.service, "site": L.site,
                    "activite": L.activite, "contrat": L.contrat, "poste": L.poste,
                    **cell(m, m1), "part": m / ligne if ligne else None,
                    "entree": m != 0 and m1 == 0, "sortie": m == 0 and bool(m1)})
    return sorted(out, key=lambda x: (-x["m"], x["salarie_id"]))
