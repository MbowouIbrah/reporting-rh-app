import smtplib
import ssl
from email.message import EmailMessage

from app.core.config import settings


def envoyer(dest: str, sujet: str, texte: str) -> bool:
    """Envoie un e-mail texte. False si SMTP_HOST est vide ; les erreurs SMTP remontent."""
    if not settings.SMTP_HOST:
        return False
    msg = EmailMessage()
    msg["From"] = settings.SMTP_FROM or settings.SMTP_USER
    msg["To"] = dest
    msg["Subject"] = sujet
    msg.set_content(texte)
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as smtp:
        if settings.SMTP_TLS:
            smtp.starttls(context=ssl.create_default_context())
        if settings.SMTP_USER:
            smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        smtp.send_message(msg)
    return True
