"""Formules du dictionnaire KPI (docs/P0_CADRAGE.md §1). Fonctions pures, Decimal exact.

Valeur « vide » : None (affiché « — »). Valeur non définie : NA (affiché « n/a »).
"""

from decimal import Decimal

NA = "n/a"
Val = Decimal | str | None
ZERO = Decimal(0)
TOLERANCE = Decimal("0.5")


def variation(m: Decimal | None, m1: Decimal | None) -> Val:
    if m is None or m1 is None:
        return None
    return m - m1


def variation_pct(m: Decimal | None, m1: Decimal | None) -> Val:
    if m is None or m1 is None:
        return None
    if m1 == 0:
        return NA
    return (m - m1) / m1


def taux_rotation(recrutements: int, departs: int, debut: int | None, fin: int) -> Val:
    if debut is None:
        return None
    denom = Decimal(debut + fin) / 2
    if denom == 0:
        return NA
    return (Decimal(recrutements + departs) / 2) / denom


def taux_absenteisme(absences: Decimal, effectif: int, jours_ouvres: Decimal) -> Val:
    denom = effectif * jours_ouvres
    return NA if denom == 0 else absences / denom


def budget(effectif: int, par_employe: Decimal | None) -> Decimal | None:
    return None if par_employe is None else par_employe * effectif


def ecart_budget(m: Decimal | None, bud: Decimal | None) -> tuple[Val, Val]:
    """(écart, écart %) = M − Budget, écart / budget."""
    if m is None or bud is None:
        return None, None
    ecart = m - bud
    return ecart, (NA if bud == 0 else ecart / bud)


def taux_marge(ca: Decimal | None, marge: Decimal | None) -> Val:
    """Marge saisie / CA saisi."""
    if ca is None or marge is None:
        return None
    return NA if ca == 0 else marge / ca


def moyenne(cumul: Decimal, nb_mois: int) -> Decimal | None:
    return None if nb_mois == 0 else cumul / nb_mois


def ecart_bloquant(*valeurs: Decimal) -> Decimal:
    """Plus grand écart absolu entre valeurs censées être égales."""
    return max(valeurs) - min(valeurs) if valeurs else ZERO
