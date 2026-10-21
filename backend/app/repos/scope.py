"""Filtre de périmètre appliqué côté serveur, dans la couche dépôt."""

from dataclasses import dataclass

from sqlalchemy import Select, and_, false
from sqlalchemy.orm import InstrumentedAttribute, Session

from app.models.auth import Perimetre
from app.security.policy import Principal


@dataclass(frozen=True)
class Scope:
    unrestricted: bool
    rules: dict[str, frozenset[str]]  # dimension -> valeurs autorisées


def scope_for(db: Session, principal: Principal) -> Scope:
    """Valeurs accordées + celles des périmètres accordés, par dimension ; global si « tout »."""
    portee = principal.portee
    if portee.tout:
        return Scope(True, {})
    rules: dict[str, set[str]] = {"service": set(portee.services), "site": set(portee.sites)}
    for pid in portee.perimetres:
        p = db.get(Perimetre, pid)
        for r in p.regles if p else []:
            rules.setdefault(r.dimension, set()).add(r.valeur)
    return Scope(False, {k: frozenset(v) for k, v in rules.items() if v})


def apply_scope(
    stmt: Select,
    scope: Scope,
    *,
    service: InstrumentedAttribute | None = None,
    site: InstrumentedAttribute | None = None,
) -> Select:
    """Restreint une requête : ET entre dimensions, OU dans une dimension. Rien d'accordé = rien.

    Une dimension restreinte sans colonne correspondante dans la requête ne laisse rien passer.
    """
    if scope.unrestricted:
        return stmt
    cols = {"service": service, "site": site}
    if not scope.rules or any(cols.get(dim) is None for dim in scope.rules):
        return stmt.where(false())
    return stmt.where(and_(*(cols[dim].in_(vals) for dim, vals in scope.rules.items())))
