from app import mail, mail_modeles
from app.core.config import settings


def test_reinitialisation_texte_et_html():
    c = mail_modeles.reinitialisation("https://x/reinitialiser#jeton=a&b", 30)
    assert "réinitialisation" in c.sujet
    assert "https://x/reinitialiser#jeton=a&b" in c.texte and "30 minutes" in c.texte
    assert 'href="https://x/reinitialiser#jeton=a&amp;b"' in c.html
    assert "30 minutes" in c.html and f"cid:{mail_modeles.LOGO_CID}" in c.html
    assert "{" not in c.html.split("<body", 1)[1]  # aucun champ du gabarit oublié


def test_invitation_echappe_l_adresse():
    c = mail_modeles.invitation("https://x/connexion-rapide#jeton=z", "<a@b.c>", 1)
    assert "&lt;a@b.c&gt;" in c.html and "<a@b.c>" not in c.html
    assert "1 jour." in c.texte and "qu'une seule fois" in c.html


def test_message_html_avec_logo_lie_et_texte(monkeypatch):
    monkeypatch.setattr(settings, "SMTP_FROM", "rh@exemple.com")
    c = mail_modeles.invitation("https://x/l", "a@b.c", 3)
    msg = mail._message("a@b.c", c.sujet, c.texte, c.html)
    assert msg["From"] == f"{settings.APP_NAME} <rh@exemple.com>"
    assert msg["Auto-Submitted"] == "auto-generated"
    types = [p.get_content_type() for p in msg.walk()]
    assert types == ["multipart/alternative", "text/plain", "multipart/related", "text/html", "image/png"]
    logo = next(p for p in msg.walk() if p.get_content_type() == "image/png")
    assert logo["Content-ID"] == f"<{mail_modeles.LOGO_CID}>"
    assert logo.get_content_disposition() == "inline"


def test_message_texte_seul_sans_html():
    msg = mail._message("a@b.c", "s", "t", None)
    assert msg.get_content_type() == "text/plain"
