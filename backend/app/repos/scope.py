"""Filtre de périmètre appliqué côté serveur, dans la couche dépôt."""

from collections.abc import Collection
from dataclasses import dataclass

from sqlalchemy import Select, and_, false, select
from sqlalchemy.orm import InstrumentedAttribute, Session

from app.models.auth import Perimetre
from app.models.referentiel import Departement, Service
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
    if portee.departements:
        # Un département accordé vaut ses services d'aujourd'hui (le filtre SQL reste par service).
        rules["service"].update(db.scalars(
            select(Service.libelle).join(Departement, Departement.id == Service.departement_id)
            .where(Departement.libelle.in_(portee.departements))))
    for pid in portee.perimetres:
        p = db.get(Perimetre, pid)
        for r in p.regles if p else []:
            rules.setdefault(r.dimension, set()).add(r.valeur)
    # département accordé sans service : dimension restreinte à rien, jamais tous les services
    return Scope(False, {k: frozenset(v) for k, v in rules.items()
                         if v or (k == "service" and portee.departements)})


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


def restreindre(db: Session, scope: Scope, departement: str | Collection[str] | None) -> Scope:
    """Filtre « département » des rapports : le périmètre réduit aux services du département
    (intersection avec ceux déjà accordés). Département inconnu ou vide : aucun service."""
    if not departement:
        return scope
    noms = [departement] if isinstance(departement, str) else list(departement)
    services = frozenset(db.scalars(
        select(Service.libelle).join(Departement, Departement.id == Service.departement_id)
        .where(Departement.libelle.in_(noms))))
    accordes = scope.rules.get("service")
    rules = dict(scope.rules)
    rules["service"] = services if accordes is None else services & accordes
    return Scope(False, rules)
