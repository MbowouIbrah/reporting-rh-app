"""Comptes de recette locaux : génère comptes.local.csv (non suivi) à partir de comptes.exemple.csv.

Usage : python tools/recette/generer_comptes.py [--force]
Adresse : <identifiant>@RECETTE_DOMAINE (défaut exemple.invalid, domaine réservé sans boîte réelle).
Mot de passe : RECETTE_PASSWORD pour tous les comptes, sinon un mot de passe aléatoire par compte.
Un fichier existant n'est pas réécrit sans --force.
"""

import argparse
import csv
import os
import secrets
from pathlib import Path

ICI = Path(__file__).resolve().parent
EXEMPLE = ICI / "comptes.exemple.csv"
LOCAL = ICI / "comptes.local.csv"
COLONNES = ["identifiant", "email", "mot_de_passe", "nom", "fonction", "modele", "perimetre",
            "nominatif"]


def generer(force: bool = False) -> Path:
    """Écrit comptes.local.csv s'il manque (ou avec force) et renvoie son chemin."""
    if LOCAL.exists() and not force:
        return LOCAL
    domaine = os.environ.get("RECETTE_DOMAINE") or "exemple.invalid"
    commun = os.environ.get("RECETTE_PASSWORD")
    with open(EXEMPLE, encoding="utf-8", newline="") as f:
        modeles = list(csv.DictReader(f, delimiter=";"))
    with open(LOCAL, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLONNES, delimiter=";", lineterminator="\n")
        w.writeheader()
        for m in modeles:
            ident = m["identifiant"].strip().lower()
            w.writerow({
                **{k: m[k] for k in COLONNES if k in m},
                "identifiant": ident,
                "email": f"{ident}@{domaine}",
                "mot_de_passe": commun or secrets.token_urlsafe(12),
            })
    return LOCAL


def charger() -> list[dict]:
    """Comptes de recette (crée comptes.local.csv au premier appel)."""
    chemin = generer()
    with open(chemin, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f, delimiter=";"))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="réécrit le fichier existant")
    args = ap.parse_args()
    existait = LOCAL.exists()
    chemin = generer(args.force)
    print(f"{chemin} {'conservé' if existait and not args.force else 'écrit'}")
