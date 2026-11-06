"""Identités fictives des tests : aucune adresse ni aucun mot de passe écrits ailleurs."""
import secrets

DOMAINE = "exemple.invalid"  # domaine réservé (RFC 2606) : aucune boîte ne peut exister


def courriel(nom: str) -> str:
    return f"{nom}@{DOMAINE}"


def mot_de_passe() -> str:
    return "t-" + secrets.token_urlsafe(18)
