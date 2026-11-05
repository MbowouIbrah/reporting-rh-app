"""Amorçage : python -m app.seed  (ADMIN_EMAIL / ADMIN_PASSWORD en environnement).

Crée l'administrateur, avec un mot de passe provisoire à changer à la première connexion, et les
deux périmètres du cadrage (hypothèses [H], éditables ensuite).
--demo ajoute des comptes de lecture d'exemple (mot de passe provisoire : DEMO_PASSWORD), refusé
en production. L'administrateur n'est créé que si aucun compte actif ne gère les comptes.
"""

import os
import sys

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.auth import (
    Perimetre,
    PerimetreRegle,
    Utilisateur,
    UtilisateurPermission,
    UtilisateurPortee,
)
from app.referentiels_init import seed_referentiels
from app.security.deps import to_principal
from app.security.passwords import check_password, hash_password
from app.security.policy import MODELES, is_allowed

# Mêmes valeurs que la migration 0011 (la base de test est créée sans migrations).
PERIMETRES = {
    "dps": ("DPS", ["Commerce Pièces", "SAV PL", "SAV Engins", "Sites Déportés"]),
    "commerce_vn": ("Commerce VN", ["Commerce VN"]),
    "pneumatique": ("Pneumatique", ["Pneumatique"]),
    "sav_pl": ("SAV PL", ["SAV PL"]),
    "sav_engins": ("SAV Engins", ["SAV Engins"]),
    "sites_deportes": ("Sites Déportés", ["Sites Déportés"]),
}


def _user(db: Session, email: str, nom: str, pw: str, modele: str, pid=None, nominatif=False,
          provisoire=True):
    """Compte créé d'après un modèle (mêmes droits que la conversion de la migration 0014)."""
    if db.scalar(select(Utilisateur).where(Utilisateur.email == email)):
        return
    fonction, tout, perms = MODELES[modele]
    perms = perms | ({"nominatif"} if nominatif else set())
    portee = UtilisateurPortee(type="tout") if tout else UtilisateurPortee(
        type="perimetre", perimetre_id=pid)
    db.add(
        Utilisateur(
            email=email,
            nom=nom,
            fonction=fonction,
            password_hash=hash_password(pw),
            doit_changer_mdp=provisoire,
            permissions=[UtilisateurPermission(permission=c) for c in sorted(perms)],
            portees=[portee],
        )
    )


def run(db: Session, admin_email: str, admin_password: str, demo_password: str | None,
        mdp_provisoire: bool = True) -> None:
    seed_referentiels(db)
    ids: dict[str, int] = {}
    for code, (libelle, services) in PERIMETRES.items():
        p = db.scalar(select(Perimetre).where(Perimetre.code == code))
        if p is None:
            p = Perimetre(
                code=code,
                libelle=libelle,
                regles=[PerimetreRegle(dimension="service", valeur=s) for s in services],
            )
            db.add(p)
            db.flush()
        ids[code] = p.id
    gestionnaire = any(
        u.actif and is_allowed(to_principal(u), "users:write")
        for u in db.scalars(select(Utilisateur))
    )
    if not gestionnaire:
        email = admin_email.lower()
        if db.scalar(select(Utilisateur).where(Utilisateur.email == email)):
            print(f"Attention : {email} existe déjà, inactif ou sans droit de gérer les comptes. "
                  "Aucun compte créé : voir python -m app.comptes activer / droits.",
                  file=sys.stderr)
        else:
            _user(db, email, "Administrateur RH", admin_password, "admin",
                  provisoire=mdp_provisoire)
    if demo_password:
        _user(db, "drh@exemple.invalid", "DRH", demo_password, "global", None, True,
              provisoire=mdp_provisoire)
        _user(db, "dop@exemple.invalid", "DOP", demo_password, "global", None, True,
              provisoire=mdp_provisoire)
        _user(db, "dps.equipment@exemple.invalid", "DPS", demo_password,
              "perimetre", ids["dps"], provisoire=mdp_provisoire)
        _user(db, "dir.commercial.vn@exemple.invalid", "Directeur commercial VN", demo_password,
              "perimetre", ids["commerce_vn"], provisoire=mdp_provisoire)
        _user(db, "dc.pneumatique@exemple.invalid", "DC Pneumatique", demo_password,
              "perimetre", ids["pneumatique"], provisoire=mdp_provisoire)
        _user(db, "dir.technique@exemple.invalid", "Directeur technique", demo_password,
              "perimetre", ids["sav_pl"], provisoire=mdp_provisoire)
        _user(db, "resp.sav.engins@exemple.invalid", "Responsable technique SAV Engins",
              demo_password, "perimetre", ids["sav_engins"], provisoire=mdp_provisoire)
        _user(db, "resp.sites.deportes@exemple.invalid", "Responsable des sites déportés",
              demo_password, "perimetre", ids["sites_deportes"], provisoire=mdp_provisoire)
    db.commit()


def _exiger_mot_de_passe_valide(variable: str, pw: str) -> None:
    """Mêmes règles que l'API ; un refus arrête l'amorçage avec un message lisible."""
    try:
        check_password(pw)
    except HTTPException as e:
        sys.exit(f"{variable} : {e.detail}")


def mot_de_passe_demo(argv: list[str]) -> str | None:
    """Mot de passe des comptes d'exemple ; ces comptes n'existent jamais en production."""
    if "--demo" not in argv:
        return None
    if settings.ENV == "prod":
        sys.exit("--demo est refusé en production")
    demo = os.environ.get("DEMO_PASSWORD")
    if not demo:
        sys.exit("DEMO_PASSWORD requis avec --demo")
    _exiger_mot_de_passe_valide("DEMO_PASSWORD", demo)
    return demo


if __name__ == "__main__":
    email, pw = os.environ.get("ADMIN_EMAIL"), os.environ.get("ADMIN_PASSWORD")
    if not email or not pw:
        sys.exit("ADMIN_EMAIL et ADMIN_PASSWORD requis")
    _exiger_mot_de_passe_valide("ADMIN_PASSWORD", pw)
    with SessionLocal() as session:
        run(session, email, pw, mot_de_passe_demo(sys.argv))
    print("seed ok")
