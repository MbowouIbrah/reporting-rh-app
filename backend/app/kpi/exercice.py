"""Année civile (janvier → décembre) ou fiscale (avril → mars, docs/etude-annee-fiscale.md).

Le moteur travaille sur des rangs 1 à 12 ; ce module fait le lien avec les vrais mois.
`annee` désigne l'année de début : l'exercice fiscal 2026 va d'avril 2026 à mars 2027."""

from typing import Literal

Calendrier = Literal["civil", "fiscal"]
DEBUT_FISCAL = 4


def mois_exercice(annee: int, calendrier: Calendrier = "civil") -> list[tuple[int, int]]:
    """Les 12 (année, mois) de l'exercice, dans l'ordre ; l'indice + 1 est le rang."""
    if calendrier != "fiscal":
        return [(annee, m) for m in range(1, 13)]
    return [(annee if m >= DEBUT_FISCAL else annee + 1, m)
            for m in (*range(DEBUT_FISCAL, 13), *range(1, DEBUT_FISCAL))]


def rang(mois: int, calendrier: Calendrier = "civil") -> int:
    """Rang (1 à 12) d'un vrai mois dans l'exercice."""
    if calendrier != "fiscal":
        return mois
    return (mois - DEBUT_FISCAL) % 12 + 1


def fin_cumul(annee: int, mois: int | None, calendrier: Calendrier = "civil") -> tuple[int, int]:
    """Vrai (année, mois) de fin du cumul ; `mois` absent : fin de l'exercice."""
    return mois_exercice(annee, calendrier)[11 if mois is None else rang(mois, calendrier) - 1]


def serie_reelle(items: list[dict], annee: int, calendrier: Calendrier) -> list[dict]:
    """Éléments indexés par rang (`mois` de 1 à 12) -> vrais `mois` et `annee`."""
    reels = mois_exercice(annee, calendrier)
    return [{**x, "annee": reels[x["mois"] - 1][0], "mois": reels[x["mois"] - 1][1]}
            for x in items]


def en_mois_reels(res: dict, annee: int, ref_annee: int, calendrier: Calendrier) -> dict:
    """Réponse du moteur annuel (rangs) -> vrais mois : `mois` et `annee` dans chaque mois des
    séries, `mois_fin` et `annee_fin` pour le dernier mois saisi."""
    out = {**res, "serie_n": serie_reelle(res["serie_n"], annee, calendrier),
           "serie_n1": serie_reelle(res["serie_n1"], ref_annee, calendrier), "annee_fin": None}
    if res.get("mois_fin"):
        out["annee_fin"], out["mois_fin"] = mois_exercice(annee, calendrier)[res["mois_fin"] - 1]
    return out
