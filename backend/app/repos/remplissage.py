"""Remplissage des colonnes : nombre de valeurs et dernier mois rempli, par rubrique."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.donnees import Montant, Periode, SituationMensuelle
from app.models.referentiel import Service, Site
from app.repos.scope import Scope, apply_scope


def annees_remplies(db: Session, scope: Scope) -> list[int]:
    """Années qui ont au moins une valeur visible, de la plus récente à la plus ancienne."""
    q = apply_scope(
        select(Periode.annee).distinct()
        .join(SituationMensuelle, SituationMensuelle.periode_id == Periode.id)
        .join(Montant, Montant.situation_id == SituationMensuelle.id)
        .join(Service, Service.id == SituationMensuelle.service_id)
        .join(Site, Site.id == SituationMensuelle.site_id),
        scope, service=Service.libelle, site=Site.libelle)
    return sorted(db.scalars(q), reverse=True)


def remplissage(db: Session, scope: Scope, annee: int) -> dict[int, tuple[int, int]]:
    """rubrique_id -> (nombre de cases remplies, dernier mois rempli) sur l'année civile.

    Une case vide n'a pas de ligne `montant` : une rubrique absente du résultat est vide."""
    q = apply_scope(
        select(Montant.rubrique_id, func.count(), func.max(Periode.mois))
        .join(SituationMensuelle, SituationMensuelle.id == Montant.situation_id)
        .join(Periode, Periode.id == SituationMensuelle.periode_id)
        .join(Service, Service.id == SituationMensuelle.service_id)
        .join(Site, Site.id == SituationMensuelle.site_id)
        .where(Periode.annee == annee)
        .group_by(Montant.rubrique_id),
        scope, service=Service.libelle, site=Site.libelle)
    return {rid: (n, mois) for rid, n, mois in db.execute(q)}
