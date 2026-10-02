import pytest

from app.security.policy import Assignment, Principal, Resource, is_allowed


def P(*a):
    return Principal(1, "u@x", tuple(a))


ADMIN = P(Assignment("rh_admin"))
GLOB = P(Assignment("lecteur_global", nominatif=True))
PER = P(Assignment("lecteur_perimetre", 5))
PER_NOM = P(Assignment("lecteur_perimetre", 5, True))


@pytest.mark.parametrize("p,action,expected", [
    (ADMIN, "users:write", True), (ADMIN, "report:write", True), (ADMIN, "marge:read", True),
    (GLOB, "report:read", True), (GLOB, "report:write", False), (GLOB, "users:write", False),
    (GLOB, "nominatif:read", True), (GLOB, "marge:read", True), (GLOB, "audit:read", False),
    (PER, "report:read", True), (PER, "report:write", False), (PER, "marge:read", False),
    (PER, "nominatif:read", False), (PER_NOM, "nominatif:read", True),
    (PER_NOM, "users:read", False), (P(), "report:read", False),
])
def test_matrice(p, action, expected):
    assert is_allowed(p, action) is expected


def test_ressource_hors_perimetre():
    assert is_allowed(PER, "report:read", Resource(perimetre_id=5))
    assert not is_allowed(PER, "report:read", Resource(perimetre_id=6))
    assert is_allowed(GLOB, "report:read", Resource(perimetre_id=6))
