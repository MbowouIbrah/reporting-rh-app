"""Année civile (janvier → décembre) ou fiscale (avril → mars, docs/etude-annee-fiscale.md).

Le moteur travaille sur des rangs 1 à 12 ; ce module fait le lien avec les vrais mois.
`annee` désigne l'année de début : l'exercice fiscal 2026 va d'avril 2026 à mars 2027."""

from typing import Literal

Calendrier = Literal["civil", "fiscal"]
Depart = Calendrier | int  # calendrier nommé, ou premier mois (1 à 12) de l'exercice
DEBUT_FISCAL = 4


def premier_mois(calendrier: Depart = "civil") -> int:
    """Premier mois de l'exercice : janvier (civil), avril (fiscal) ou le mois donné."""
    if isinstance(calendrier, int):
        return calendrier
    return DEBUT_FISCAL if calendrier == "fiscal" else 1


def mois_exercice(annee: int, calendrier: Depart = "civil") -> list[tuple[int, int]]:
    """Les 12 (année, mois) de l'exercice, dans l'ordre ; l'indice + 1 est le rang."""
    p = premier_mois(calendrier)
    return [(annee + (p - 1 + k) // 12, (p - 1 + k) % 12 + 1) for k in range(12)]


def rang(mois: int, calendrier: Depart = "civil") -> int:
    """Rang (1 à 12) d'un vrai mois dans l'exercice."""
    return (mois - premier_mois(calendrier)) % 12 + 1


def fin_cumul(annee: int, mois: int | None, calendrier: Depart = "civil") -> tuple[int, int]:
    """Vrai (année, mois) de fin du cumul ; `mois` absent : fin de l'exercice."""
    return mois_exercice(annee, calendrier)[11 if mois is None else rang(mois, calendrier) - 1]


def serie_reelle(items: list[dict], annee: int, calendrier: Depart) -> list[dict]:
    """Éléments indexés par rang (`mois` de 1 à 12) -> vrais `mois` et `annee`."""
    reels = mois_exercice(annee, calendrier)
    return [{**x, "annee": reels[x["mois"] - 1][0], "mois": reels[x["mois"] - 1][1]}
            for x in items]


def en_mois_reels(res: dict, annee: int, ref_annee: int, calendrier: Depart) -> dict:
    """Réponse du moteur annuel (rangs) -> vrais mois : `mois` et `annee` dans chaque mois des
    séries, `mois_fin` et `annee_fin` pour le dernier mois saisi."""
    out = {**res, "serie_n": serie_reelle(res["serie_n"], annee, calendrier),
           "serie_n1": serie_reelle(res["serie_n1"], ref_annee, calendrier), "annee_fin": None}
    if res.get("mois_fin"):
        out["annee_fin"], out["mois_fin"] = mois_exercice(annee, calendrier)[res["mois_fin"] - 1]
    return out


def indice(texte: str) -> int:
    """« AAAA-MM » -> indice de mois (année * 12 + mois - 1)."""
    return int(texte[:4]) * 12 + int(texte[5:7]) - 1


def texte(i: int) -> str:
    """Indice de mois -> « AAAA-MM »."""
    return f"{i // 12:04d}-{i % 12 + 1:02d}"
