"""Comparaison floue de noms : insensible aux espaces parasites, à la casse, aux accents et à l'ordre des mots."""

from difflib import SequenceMatcher

from app.imports.lecture import norm

SEUIL_NOM_PROCHE = 0.80  # même matricule : au-delà, on parle de faute de frappe
SEUIL_NOUVEAU_PROCHE = 0.88  # matricule inconnu : au-delà, le nom existe sans doute déjà


def similarite(a: str, b: str) -> float:
    """Score entre 0 et 1 : meilleur de la comparaison directe et de la comparaison mots triés."""
    a, b = norm(a), norm(b)
    if a == b:
        return 1.0
    if not a or not b:
        return 0.0
    tri_a, tri_b = " ".join(sorted(a.split())), " ".join(sorted(b.split()))
    return max(SequenceMatcher(None, a, b).ratio(), SequenceMatcher(None, tri_a, tri_b).ratio())


def plus_proche(nom: str, annuaire: dict[str, tuple[str, str]], hors: str, seuil: float):
    """(matricule, nom, score) du nom le plus ressemblant de l'annuaire {clé: (matricule, nom)}, au moins `seuil`."""
    cible = norm(nom)
    meilleur = None
    for cle, (matricule, autre) in annuaire.items():
        if cle == hors:
            continue
        if SequenceMatcher(None, cible, norm(autre)).real_quick_ratio() < seuil:
            continue  # majorant par la longueur : inutile d'aller plus loin
        score = similarite(nom, autre)
        if score >= seuil and (meilleur is None or score > meilleur[2]):
            meilleur = (matricule, autre, score)
    return meilleur
