"""Filtre de périmètre appliqué côté serveur, dans la couche dépôt."""

from dataclasses import dataclass

from sqlalchemy import Select, false, or_
from sqlalchemy.orm import InstrumentedAttribute, Session

from app.models.auth import Perimetre
from app.security.policy import PERIMETRE, Principal


@dataclass(frozen=True)
class Scope:
    unrestricted: bool
    rules: dict[str, frozenset[str]]  # dimension -> valeurs autorisées


def scope_for(db: Session, principal: Principal) -> Scope:
    """Union des périmètres du principal ; global si un rôle global existe."""
    if principal.is_global:
        return Scope(True, {})
    rules: dict[str, set[str]] = {}
    for a in principal.assignments:
        if a.role != PERIMETRE or a.perimetre_id is None:
            continue
        p = db.get(Perimetre, a.perimetre_id)
        for r in p.regles if p else []:
            rules.setdefault(r.dimension, set()).add(r.valeur)
    return Scope(False, {k: frozenset(v) for k, v in rules.items()})


def apply_scope(
    stmt: Select,
    scope: Scope,
    *,
    service: InstrumentedAttribute | None = None,
    site: InstrumentedAttribute | None = None,
) -> Select:
    """Restreint une requête. Périmètre sans règle exploitable = aucune donnée."""
    if scope.unrestricted:
        return stmt
    cols = {"service": service, "site": site}
    conds = [
        cols[dim].in_(vals)
        for dim, vals in scope.rules.items()
        if cols.get(dim) is not None and vals
    ]
    return stmt.where(or_(*conds)) if conds else stmt.where(false())
