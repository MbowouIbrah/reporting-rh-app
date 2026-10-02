"""Amorçage : python -m app.seed  (ADMIN_EMAIL / ADMIN_PASSWORD en environnement).

Crée le rh_admin et les deux périmètres du cadrage (hypothèses [H], éditables ensuite).
--demo ajoute des comptes de lecture d'exemple (mot de passe : DEMO_PASSWORD).
"""

import os
import sys

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.auth import Perimetre, PerimetreRegle, RoleAssignment, Utilisateur
from app.referentiels_init import seed_referentiels
from app.security.passwords import hash_password

PERIMETRES = {
    "equipment": (
        "Equipment",
        ["SAV PL", "SAV Engins", "Pneumatique", "Sites Déportés"],
    ),
    "commerce_vn": ("Commerce VN", ["Commerce VN"]),
}


def _user(db: Session, email: str, nom: str, pw: str, role: str, pid=None, nominatif=False):
    if db.scalar(select(Utilisateur).where(Utilisateur.email == email)):
        return
    db.add(
        Utilisateur(
            email=email,
            nom=nom,
            password_hash=hash_password(pw),
            roles=[RoleAssignment(role=role, perimetre_id=pid, nominatif=nominatif)],
        )
    )


def run(db: Session, admin_email: str, admin_password: str, demo_password: str | None) -> None:
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
    _user(db, admin_email.lower(), "Administrateur RH", admin_password, "rh_admin")
    if demo_password:
        _user(db, "drh@exemple.invalid", "DRH", demo_password, "lecteur_global", None, True)
        _user(db, "dop@exemple.invalid", "DOP", demo_password, "lecteur_global", None, True)
        _user(db, "dps.equipment@exemple.invalid", "DPS Equipment", demo_password,
              "lecteur_perimetre", ids["equipment"])
        _user(db, "dir.commercial.vn@exemple.invalid", "Directeur commercial VN", demo_password,
              "lecteur_perimetre", ids["commerce_vn"])
    db.commit()


if __name__ == "__main__":
    email, pw = os.environ.get("ADMIN_EMAIL"), os.environ.get("ADMIN_PASSWORD")
    if not email or not pw or len(pw) < 12:
        sys.exit("ADMIN_EMAIL et ADMIN_PASSWORD (12 caractères min) requis")
    demo = os.environ.get("DEMO_PASSWORD") if "--demo" in sys.argv else None
    with SessionLocal() as session:
        run(session, email, pw, demo)
    print("seed ok")
