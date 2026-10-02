from dataclasses import dataclass, field

from fastapi import HTTPException

ADMIN = "rh_admin"
GLOBAL = "lecteur_global"
PERIMETRE = "lecteur_perimetre"

# Matrice rôle -> actions (docs/P0_CADRAGE.md §2). Seul rh_admin écrit.
_READ = {"report:read", "perimetre:read"}
POLICY: dict[str, set[str]] = {
    ADMIN: _READ
    | {
        "report:write",
        "perimetre:write",
        "users:read",
        "users:write",
        "audit:read",
        "import:read",
        "import:write",
        "periode:write",
        "nominatif:read",
        "marge:read",
    },
    GLOBAL: _READ | {"nominatif:read", "marge:read"},
    PERIMETRE: _READ | {"nominatif:read"},  # soumis au drapeau nominatif
}


@dataclass(frozen=True)
class Assignment:
    role: str
    perimetre_id: int | None = None
    nominatif: bool = False


@dataclass(frozen=True)
class Principal:
    user_id: int
    email: str
    assignments: tuple[Assignment, ...] = field(default_factory=tuple)

    @property
    def is_global(self) -> bool:
        return any(a.role in (ADMIN, GLOBAL) for a in self.assignments)


@dataclass(frozen=True)
class Resource:
    perimetre_id: int | None = None


def is_allowed(principal: Principal, action: str, resource: Resource | None = None) -> bool:
    for a in principal.assignments:
        if action not in POLICY.get(a.role, set()):
            continue
        if action == "nominatif:read" and a.role == PERIMETRE and not a.nominatif:
            continue
        if (
            a.role == PERIMETRE
            and resource is not None
            and resource.perimetre_id is not None
            and resource.perimetre_id != a.perimetre_id
        ):
            continue
        return True
    return False


def authorize(principal: Principal, action: str, resource: Resource | None = None) -> None:
    if not is_allowed(principal, action, resource):
        raise HTTPException(status_code=403, detail="Accès refusé")
