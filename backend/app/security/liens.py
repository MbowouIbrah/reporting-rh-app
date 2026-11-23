"""Liens de connexion directe (démo, invitation).

Le jeton (32 octets aléatoires) n'existe que dans le lien envoyé ; la base garde son empreinte
sha256 : une copie de la base ne permet pas de se connecter. Retours N2 (5) : le lien ne sert qu'une
fois (grillé dès la 1re connexion), la personne choisit alors son mot de passe ; il expire et se
révoque à tout moment.
"""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models.auth import LienConnexion, Utilisateur

JOURS_DEFAUT = 14


class LienDejaUtilise(Exception):
    """Le lien a déjà servi : la personne se connecte avec son e-mail et son mot de passe."""


def _empreinte(jeton: str) -> str:
    return hashlib.sha256(jeton.encode()).hexdigest()


def _utc(d: datetime) -> datetime:
    # SQLite rend les dates sans fuseau : elles sont écrites en UTC.
    return d if d.tzinfo else d.replace(tzinfo=UTC)


def url(base: str, jeton: str) -> str:
    """Le jeton est dans le fragment : il ne part jamais vers le serveur ni dans les journaux."""
    return f"{base.rstrip('/')}/connexion-rapide#jeton={jeton}"


def creer(db: Session, user: Utilisateur, jours: int = JOURS_DEFAUT) -> str:
    """Crée un lien pour `user` et rend le jeton (à placer dans l'URL, jamais stocké)."""
    if jours < 1:
        raise ValueError("durée d'au moins un jour")
    jeton = secrets.token_urlsafe(32)
    db.add(LienConnexion(utilisateur_id=user.id, empreinte=_empreinte(jeton),
                         expire_le=datetime.now(UTC) + timedelta(days=jours)))
    return jeton


def utiliser(db: Session, jeton: str) -> Utilisateur | None:
    """Compte du lien s'il est valide (ni expiré, ni révoqué, compte actif, jamais utilisé).
    Usage compté ; le compte doit ensuite choisir son mot de passe.
    Lève LienDejaUtilise si le lien a déjà servi."""
    if not jeton or len(jeton) > 200:
        return None
    lien = db.scalar(select(LienConnexion).where(LienConnexion.empreinte == _empreinte(jeton)))
    maintenant = datetime.now(UTC)
    if lien is None or lien.revoque_le is not None or _utc(lien.expire_le) <= maintenant:
        return None
    user = db.get(Utilisateur, lien.utilisateur_id)
    if user is None or not user.actif:
        return None
    if lien.nb_utilisations > 0:
        raise LienDejaUtilise
    lien.nb_utilisations += 1
    lien.derniere_utilisation = maintenant
    user.doit_changer_mdp = True
    return user


def revoquer(db: Session, user: Utilisateur | None = None) -> int:
    """Révoque les liens encore actifs (d'un compte, ou de tous) ; rend leur nombre."""
    q = update(LienConnexion).where(LienConnexion.revoque_le.is_(None))
    if user is not None:
        q = q.where(LienConnexion.utilisateur_id == user.id)
    return db.execute(q.values(revoque_le=datetime.now(UTC))).rowcount
