import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr
from pathlib import Path

from app.core.config import settings
from app.mail_modeles import LOGO_CID

log = logging.getLogger(__name__)

LOGO = Path(__file__).resolve().parent / "assets" / "cfao_logo.png"


def _message(dest: str, sujet: str, texte: str, html: str | None) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = formataddr((settings.APP_NAME, settings.SMTP_FROM or settings.SMTP_USER))
    msg["To"] = dest
    msg["Subject"] = sujet
    # Message transactionnel : pas de réponse automatique (absence du bureau, accusé).
    msg["Auto-Submitted"] = "auto-generated"
    msg["X-Auto-Response-Suppress"] = "All"
    msg.set_content(texte)
    if html is not None:
        msg.add_alternative(html, subtype="html")
        try:
            # Logo lié à la partie HTML (multipart/related) : affiché dans le corps,
            # pas en pièce jointe.
            msg.get_payload()[1].add_related(
                LOGO.read_bytes(), "image", "png", cid=f"<{LOGO_CID}>",
                disposition="inline", filename="cfao.png",
            )
        except OSError:
            log.warning("Logo d'e-mail introuvable : %s", LOGO)
    return msg


def envoyer(dest: str, sujet: str, texte: str, html: str | None = None) -> bool:
    """Envoie un e-mail (texte, plus HTML si fourni).

    False si SMTP_HOST est vide ou le destinataire hors MAIL_DESTINATAIRES_AUTORISES ;
    les erreurs SMTP remontent.
    """
    if not settings.SMTP_HOST:
        return False
    autorises = {a.strip().lower() for a in settings.MAIL_DESTINATAIRES_AUTORISES.split(",")
                 if a.strip()}
    if autorises and dest.strip().lower() not in autorises:
        log.warning("E-mail non envoyé : destinataire hors liste autorisée")
        return False
    msg = _message(dest, sujet, texte, html)
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as smtp:
        if settings.SMTP_TLS:
            smtp.starttls(context=ssl.create_default_context())
        if settings.SMTP_USER:
            smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        smtp.send_message(msg)
    log.info("E-mail envoyé : %s", sujet)
    return True
