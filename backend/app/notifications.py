"""Notifications : cloche de l'appli et e-mail sur abonnement (étude d'import automatique).

Aucune fonction ne commite : l'appelant le fait. Jamais de montant dans un message. Une alerte
« données du mois disponibles » n'est envoyée qu'une fois par utilisateur, mois et canal (registre
`notification_envoi`), même si le mois est republié."""

import hashlib
import hmac
import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import mail
from app.core.config import settings
from app.imports.regles import MOIS
from app.models.auth import Utilisateur
from app.models.imports import LotImport, StagingLigne
from app.models.notifications import Notification, NotificationEnvoi
from app.repos.scope import Scope, scope_for
from app.security.deps import to_principal
from app.security.policy import is_allowed

LOG = logging.getLogger("app.notifications")

LIEN_IMPORT = "/admin/saisie"
LIEN_RAPPORT = "/mensuel"


def _de(mois: int, annee: int) -> str:
    nom = MOIS[mois - 1].lower()
    return f"{'d’' if nom[0] in 'aeiouéèâ' else 'de '}{nom} {annee}"


def _actifs(db: Session) -> list[Utilisateur]:
    return list(db.scalars(select(Utilisateur).where(Utilisateur.actif.is_(True))
                           .order_by(Utilisateur.id)))


def admins(db: Session) -> list[int]:
    """Utilisateurs actifs qui peuvent importer la paie."""
    return [u.id for u in _actifs(db) if is_allowed(to_principal(u), "import:write")]


def notifier(db: Session, ids: list[int], type: str, titre: str, texte: str,
             lien: str | None = None, lot_id: int | None = None) -> None:
    for uid in dict.fromkeys(ids):
        db.add(Notification(utilisateur_id=uid, type=type, titre=titre[:200], texte=texte[:500],
                            lien=lien, lot_id=lot_id))


# ---- événements d'import ----
def lot_recu(db: Session, lot: LotImport) -> None:
    n = lot.nb_bloquants or 0
    texte = f"{n} problème{'s' if n > 1 else ''} à régler" if n else "Prêt pour l’aperçu"
    notifier(db, admins(db), "lot_recu", f"Fichier reçu : {lot.fichier_nom}", texte,
             LIEN_IMPORT, lot.id)


def _en_scope(scope: Scope, service: str | None, site: str | None) -> bool:
    if scope.unrestricted:
        return True
    valeurs = {"service": service, "site": site}
    return bool(scope.rules) and all(valeurs.get(dim) in vals for dim, vals in scope.rules.items())


def lot_publie(db: Session, lot: LotImport) -> None:
    """Admins : « <Mois année> publié ». Utilisateurs : une alerte par mois de leur périmètre."""
    lignes = list(db.execute(select(StagingLigne.annee, StagingLigne.mois, StagingLigne.donnees)
                             .where(StagingLigne.lot_id == lot.id)))
    contenu: dict[tuple[int, int], set[tuple[str | None, str | None]]] = {}
    for annee, mois, donnees in lignes:
        if annee and mois:
            paire = (donnees.get("service"), donnees.get("site"))
            contenu.setdefault((annee, mois), set()).add(paire)
    mois_lot = sorted(contenu)
    titre = (" ; ".join(f"{MOIS[m - 1]} {a}" for a, m in mois_lot) + " publié"
             if mois_lot else f"Fichier publié : {lot.fichier_nom}")
    notifier(db, admins(db), "lot_publie", titre, f"Fichier {lot.fichier_nom}", LIEN_IMPORT, lot.id)
    if not mois_lot:
        return
    for u in _actifs(db):
        principal = to_principal(u)
        if not is_allowed(principal, "report:read"):
            continue
        scope = scope_for(db, principal)
        for annee, mois in mois_lot:
            if any(_en_scope(scope, s, t) for s, t in contenu[(annee, mois)]):
                _disponible(db, u, annee, mois, lot.id)


def _deja(db: Session, uid: int, annee: int, mois: int, canal: str) -> bool:
    return db.scalar(select(NotificationEnvoi.id).where(
        NotificationEnvoi.utilisateur_id == uid, NotificationEnvoi.annee == annee,
        NotificationEnvoi.mois == mois, NotificationEnvoi.canal == canal)) is not None


def _disponible(db: Session, u: Utilisateur, annee: int, mois: int, lot_id: int) -> None:
    if not _deja(db, u.id, annee, mois, "appli"):
        db.add(NotificationEnvoi(utilisateur_id=u.id, annee=annee, mois=mois, canal="appli"))
        notifier(db, [u.id], "donnees_disponibles",
                 f"Les données {_de(mois, annee)} sont disponibles",
                 "Le rapport du mois est consultable.", LIEN_RAPPORT, lot_id)
    if u.notif_mail and settings.SMTP_HOST and not _deja(db, u.id, annee, mois, "mail"):
        sujet = f"{settings.APP_NAME} : données {_de(mois, annee)} disponibles"
        texte = (f"Bonjour,\n\nLes données {_de(mois, annee)} sont disponibles dans "
                 f"{settings.APP_NAME} :\n{settings.APP_URL.rstrip('/')}{LIEN_RAPPORT}\n\n"
                 f"Pour ne plus recevoir ces e-mails :\n{url_desabonnement(u.id)}")
        try:
            if mail.envoyer(u.email, sujet, texte):
                db.add(NotificationEnvoi(utilisateur_id=u.id, annee=annee, mois=mois, canal="mail"))
        except Exception:
            LOG.exception("Envoi de l'e-mail de notification impossible (utilisateur %s)", u.id)


# ---- désabonnement ----
def _signature(uid: int) -> str:
    return hmac.new(settings.SECRET_KEY.encode(), f"desabonnement:{uid}".encode(),
                    hashlib.sha256).hexdigest()


def jeton_desabonnement(uid: int) -> str:
    return f"{uid}.{_signature(uid)}"


def lire_jeton(jeton: str) -> int | None:
    uid, _, sig = jeton.partition(".")
    if not uid.isdigit() or len(uid) > 12 or not hmac.compare_digest(
            sig.encode(), _signature(int(uid)).encode()):
        return None
    return int(uid)


def url_desabonnement(uid: int) -> str:
    """Le jeton est dans le fragment : il ne part pas vers le serveur ni dans les journaux."""
    return f"{settings.APP_URL.rstrip('/')}/desabonnement#jeton={jeton_desabonnement(uid)}"


def regler_mail(user: Utilisateur, actif: bool) -> None:
    if actif and not user.notif_mail:
        user.notif_mail_depuis = datetime.now(UTC)
    user.notif_mail = actif
