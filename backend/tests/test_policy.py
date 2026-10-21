import pytest

from app.security.policy import (
    ACCORDABLES,
    PERMISSIONS,
    Portee,
    Principal,
    Resource,
    is_allowed,
)

TOUT = Portee(tout=True)
P5 = Portee(perimetres=frozenset({5}))


def P(portee=Portee(), *perms):
    return Principal(1, "u@x", frozenset(perms), portee)


ADMIN = P(TOUT, *ACCORDABLES)
GLOB = P(TOUT, "nominatif", "marge")
PER = P(P5)
PER_NOM = P(P5, "nominatif")
# Permissions d'écriture accordées sans « toutes les données » : sans effet.
PER_FORCE = P(P5, *ACCORDABLES)


@pytest.mark.parametrize("p,action,expected", [
    (ADMIN, "users:write", True), (ADMIN, "import:write", True), (ADMIN, "periode:write", True),
    (GLOB, "import:read", False), (GLOB, "import:write", False), (PER, "import:write", False),
    (PER_NOM, "import:read", False), (PER, "periode:write", False), (ADMIN, "report:write", True),
    (ADMIN, "marge:read", True), (ADMIN, "audit:read", True),
    (GLOB, "report:read", True), (GLOB, "report:write", False), (GLOB, "users:write", False),
    (GLOB, "nominatif:read", True), (GLOB, "marge:read", True), (GLOB, "audit:read", False),
    (PER, "report:read", True), (PER, "report:write", False), (PER, "marge:read", False),
    (PER, "nominatif:read", False), (PER_NOM, "nominatif:read", True),
    (PER_NOM, "users:read", False), (PER_FORCE, "users:write", False),
    (PER_FORCE, "marge:read", False), (PER_FORCE, "import:read", False),
    (PER_FORCE, "nominatif:read", True), (PER_FORCE, "audit:read", False),
    (P(), "report:read", False), (P(Portee(), *ACCORDABLES), "nominatif:read", False),
    (P(Portee(services=frozenset({"SAV PL"}))), "report:read", True),
    (ADMIN, "action:inconnue", False),
])
def test_matrice(p, action, expected):
    assert is_allowed(p, action) is expected


def test_ressource_hors_perimetre():
    assert is_allowed(PER, "report:read", Resource(perimetre_id=5))
    assert not is_allowed(PER, "report:read", Resource(perimetre_id=6))
    assert is_allowed(GLOB, "report:read", Resource(perimetre_id=6))


def test_catalogue_ecritures_exigent_tout():
    exigent = {c for c, p in PERMISSIONS.items() if p.portee_tout}
    assert exigent == {"marge", "import", "saisie", "referentiel", "comptes", "journal"}


def test_perimetres_alignes_sur_les_services(db):
    from sqlalchemy import select

    from app.models.auth import Perimetre
    from app.models.referentiel import Service

    services = set(db.scalars(select(Service.libelle)))
    for p in db.scalars(select(Perimetre)):
        assert {r.valeur for r in p.regles} <= services
