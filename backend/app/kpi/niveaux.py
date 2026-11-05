"""Résolution des valeurs saisies à un niveau (global, site, service, case site x service).

Fonction pure, sans base de données. Une case vide se calcule depuis les employés (CA et marge
seulement) ; la saisie et le calcul ne s'additionnent jamais. Quand les deux existent et diffèrent,
la saisie la plus récente est retenue et la case est en conflit, jusqu'au choix de l'utilisateur.
À égalité, ou si une date manque d'un côté ou de l'autre, la case saisie est retenue.
"""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

ZERO = Decimal(0)
NIVEAUX = ("global", "site", "service", "cellule")
GROUPES: dict[str, tuple[str, ...]] = {
    "ca_marge": ("ca", "marge"),
    "activite": ("or", "devis", "factures"),
    "obj_ca_marge": ("obj_ca", "obj_marge"),
    "obj_activite": ("obj_ventes", "obj_clients", "obj_factures", "obj_productivite"),
}
# Objectifs : jamais calculés depuis les employés, saisis au niveau global par défaut.
GROUPES_OBJECTIFS = ("obj_ca_marge", "obj_activite")
# Indicateurs dont le total de plusieurs cases est la moyenne simple et non la somme.
MOYENNE = {"obj_productivite"}
# Seuls ces indicateurs ont un niveau employé (rubriques « CA individuel », « Marge individuelle »).
INDICATEURS_EMPLOYE = ("ca", "marge")

Cle = tuple[int | None, int | None]  # (site_id, service_id)


@dataclass(frozen=True)
class Employe:
    """Un employé du mois : sa case et ses valeurs individuelles (indicateur -> montant)."""

    site_id: int
    service_id: int
    valeurs: dict[str, Decimal]


@dataclass(frozen=True)
class ValeurCase:
    saisi: Decimal | None
    employes: Decimal | None
    valeur: Decimal | None
    origine: str | None  # saisi | calcule | None
    ecart: Decimal | None  # saisi - employes quand les deux existent (le « non réparti »)
    conflit: bool = False  # les deux existent, diffèrent, et aucun choix ne vaut encore


@dataclass(frozen=True)
class CaseResolue:
    site_id: int | None
    service_id: int | None
    valeurs: dict[str, ValeurCase]

    @property
    def cle(self) -> Cle:
        return (self.site_id, self.service_id)


@dataclass(frozen=True)
class Total:
    valeur: Decimal | None
    partiel: bool
    renseignes: int
    attendus: int


@dataclass(frozen=True)
class Resolution:
    groupe: str
    niveau: str
    cases: tuple[CaseResolue, ...]
    totaux: dict[str, Total]


def niveau_de(site_id: int | None, service_id: int | None) -> str:
    if site_id is None and service_id is None:
        return "global"
    if service_id is None:
        return "site"
    if site_id is None:
        return "service"
    return "cellule"


def cle_du_niveau(niveau: str, site_id: int | None, service_id: int | None) -> Cle:
    """Clé de case d'un niveau : la dimension absente du niveau est ignorée."""
    return (site_id if niveau in ("site", "cellule") else None,
            service_id if niveau in ("service", "cellule") else None)


def niveau_des_lignes(cles: list[Cle]) -> str | None:
    """Niveau des lignes existantes (le plus fin si elles se mélangent) ; None si aucune."""
    vus = {niveau_de(*c) for c in cles}
    for n in reversed(NIVEAUX):
        if n in vus:
            return n
    return None


def plus_fin(source: str, cible: str) -> bool:
    """Une valeur du niveau source se range sans ambiguïté dans une case du niveau cible."""
    return (source == "cellule" and cible != "cellule") or (
        source in ("site", "service") and cible == "global")


def projeter(cases: list[CaseResolue], cible: str,
             indicateurs: tuple[str, ...]) -> dict[Cle, dict[str, Decimal]]:
    """Somme des valeurs de cases d'un niveau plus fin, rangées par case du niveau cible. Un
    indicateur n'est proposé pour une case cible que si au moins une case source est saisie."""
    somme: dict[tuple[Cle, str], Decimal] = {}
    nombre: dict[tuple[Cle, str], int] = {}
    saisi: set[tuple[Cle, str]] = set()
    for c in cases:
        k = cle_du_niveau(cible, c.site_id, c.service_id)
        for ind in indicateurs:
            v = c.valeurs[ind]
            if v.valeur is not None:
                somme[(k, ind)] = somme.get((k, ind), ZERO) + v.valeur
                nombre[(k, ind)] = nombre.get((k, ind), 0) + 1
            if v.origine == "saisi":
                saisi.add((k, ind))
    out: dict[Cle, dict[str, Decimal]] = {}
    for k, ind in saisi:
        v = somme[(k, ind)] / nombre[(k, ind)] if ind in MOYENNE else somme[(k, ind)]
        if saisissable(v):  # une moyenne sans fin (250 / 3) n'est pas proposée
            out.setdefault(k, {})[ind] = v
    return out


def saisissable(v: Decimal) -> bool:
    """La valeur tient dans la précision d'une saisie (12 décimales au plus)."""
    return v.normalize().as_tuple().exponent >= -12


def niveau_par_defaut(groupe: str, employes: list[Employe]) -> str:
    """CA et marge : par case si des employés portent un CA ou une marge individuels, sinon global.
    Activité : par case. Objectifs : global."""
    if groupe in GROUPES_OBJECTIFS:
        return "global"
    if groupe == "activite":
        return "cellule"
    avec = any(e.valeurs.get(i) is not None for e in employes for i in INDICATEURS_EMPLOYE)
    return "cellule" if avec else "global"


def totaliser(cases: tuple[CaseResolue, ...] | list[CaseResolue],
              indicateurs: tuple[str, ...]) -> dict[str, Total]:
    totaux = {}
    for ind in indicateurs:
        vals = [c.valeurs[ind].valeur for c in cases if c.valeurs[ind].valeur is not None]
        if not vals:
            total = None
        elif ind in MOYENNE:
            total = sum(vals, ZERO) / len(vals)
        else:
            total = sum(vals, ZERO)
        totaux[ind] = Total(total, len(vals) < len(cases), len(vals), len(cases))
    return totaux


def _valeur_case(s: Decimal | None, e: Decimal | None, d_s: datetime | None,
                 d_e: datetime | None, tranche: datetime | None) -> ValeurCase:
    if s is None or e is None:
        origine = "saisi" if s is not None else ("calcule" if e is not None else None)
        return ValeurCase(s, e, s if s is not None else e, origine, None)
    employes_gagnent = s != e and d_e is not None and d_s is not None and d_e > d_s
    regle = tranche is not None and (d_e is None or d_e <= tranche)
    return ValeurCase(s, e, e if employes_gagnent else s,
                      "calcule" if employes_gagnent else "saisi",
                      s - e, s != e and not regle)


def resoudre(
    groupe: str,
    niveau: str,
    *,
    sites: list[int],
    services: list[int],
    saisies: dict[tuple[str, int | None, int | None], Decimal],
    employes: list[Employe],
    dates_saisies: dict[tuple[str, int | None, int | None], datetime] | None = None,
    dates_employes: dict[tuple[str, int | None, int | None], datetime] | None = None,
    tranches: dict[tuple[str, int | None, int | None], datetime] | None = None,
) -> Resolution:
    """Cases du groupe au niveau demandé.

    `sites` et `services` : ids actifs. `saisies` : lignes du groupe (indicateur, site, service)
    -> valeur ; celles d'un autre niveau sont ignorées. `employes` : tous les employés du mois.
    `dates_saisies` : dernier changement de chaque saisie ; `dates_employes` : dernier changement
    de la somme des employés à chaque niveau de case ; `tranches` : date du choix « garder la
    saisie ».
    """
    indicateurs = GROUPES[groupe]
    saisi: dict[tuple[str, Cle], Decimal] = {}
    for (ind, si, se), v in saisies.items():
        if ind in indicateurs and niveau_de(si, se) == niveau:
            saisi[(ind, (si, se))] = v
    calcule: dict[tuple[str, Cle], Decimal] = {}
    for e in employes:
        k = cle_du_niveau(niveau, e.site_id, e.service_id)
        for ind in indicateurs:
            v = e.valeurs.get(ind) if ind in INDICATEURS_EMPLOYE else None
            if v is not None:
                calcule[(ind, k)] = calcule.get((ind, k), ZERO) + v

    if niveau == "global":
        cles: set[Cle] = {(None, None)}
    elif niveau == "site":
        cles = {(s, None) for s in sites}
    elif niveau == "service":
        cles = {(None, s) for s in services}
    else:
        cles = {(e.site_id, e.service_id) for e in employes}
    # une valeur ne se perd jamais : une case saisie ou calculée existe même hors des actifs
    cles |= {k for _i, k in saisi} | {k for _i, k in calcule}

    cases = []
    for k in sorted(cles, key=lambda c: (c[0] or 0, c[1] or 0)):
        valeurs = {}
        for ind in indicateurs:
            s, e = saisi.get((ind, k)), calcule.get((ind, k))
            valeurs[ind] = _valeur_case(s, e, (dates_saisies or {}).get((ind, *k)),
                                        (dates_employes or {}).get((ind, *k)),
                                        (tranches or {}).get((ind, *k)))
        cases.append(CaseResolue(k[0], k[1], valeurs))
    return Resolution(groupe, niveau, tuple(cases), totaliser(cases, indicateurs))
