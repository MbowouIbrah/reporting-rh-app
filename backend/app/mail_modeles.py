# ruff: noqa: E501  (HTML d'e-mail en styles en ligne : lignes longues assumées)
"""Modèles des e-mails : textes et mise en page, séparés de l'envoi (app/mail.py).

Chaque modèle rend un `Courriel` : un sujet, une version texte (lue par les
messageries sans HTML et par les filtres anti-spam) et une version HTML.

Mise en page : tableaux et styles en ligne, seule forme rendue à l'identique
par Outlook, Gmail et Apple Mail. Couleurs reprises de
frontend/src/styles/tokens.css ; angles droits, rayon 8 px sur le bouton seul.
Le logo voyage dans le message (cid:), une image distante étant bloquée par
défaut par la plupart des messageries.
"""
from __future__ import annotations

from dataclasses import dataclass
from html import escape

from app.core.config import settings

LOGO_CID = "logo-cfao"

COULEURS = {
    "rouge": "#e3001b",
    "marine": "#1a1f3c",
    "encre": "#0e1126",
    "gris": "#6b6f82",
    "gris_clair": "#9499ab",
    "trait": "#e7e7ea",
    "fond": "#f5f5f5",
    "fond_doux": "#fafafa",
}


@dataclass(frozen=True)
class Courriel:
    sujet: str
    texte: str
    html: str


GABARIT = """\
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{sujet}</title></head>
<body style="margin:0;padding:0;background:{fond};font-family:'Segoe UI',Roboto,Arial,sans-serif;color:{encre}">
  <div style="display:none;max-height:0;overflow:hidden">{apercu}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{fond};padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid {trait}">

        <tr><td style="height:4px;background:{rouge};font-size:0;line-height:0">&nbsp;</td></tr>

        <tr><td style="padding:24px 32px 18px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle">
              <img src="cid:{cid}" width="96" alt="CFAO" style="display:block;border:0;height:auto">
            </td>
            <td align="right" style="vertical-align:middle;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:{gris}">
              {appli}<br><span style="color:{rouge};font-weight:600">{bandeau}</span>
            </td>
          </tr></table>
        </td></tr>

        <tr><td style="padding:0 32px"><div style="height:1px;background:{trait};font-size:0;line-height:0">&nbsp;</div></td></tr>

        <tr><td style="padding:28px 32px 8px">
          <h1 style="font-size:20px;line-height:1.3;font-weight:700;color:{marine};margin:0 0 14px">{titre}</h1>
          <p style="font-size:14px;line-height:1.6;color:{encre};margin:0 0 12px">Bonjour,</p>
          {paragraphes}
        </td></tr>

        <tr><td style="padding:12px 32px 8px">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="background:{rouge};border-radius:8px">
              <a href="{url}" style="display:inline-block;padding:13px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px">{bouton}</a>
            </td>
          </tr></table>
        </td></tr>

        <tr><td style="padding:14px 32px 8px">{bloc}</td></tr>

        <tr><td style="padding:8px 32px 24px">
          <p style="font-size:12px;line-height:1.5;color:{gris};margin:0 0 4px">Le bouton ne fonctionne pas ? Copiez ce lien dans votre navigateur :</p>
          <p style="font-size:12px;line-height:1.5;margin:0;word-break:break-all"><a href="{url}" style="color:{marine}">{url_lisible}</a></p>
        </td></tr>

        <tr><td style="padding:16px 32px 22px;background:{fond_doux};border-top:1px solid {trait}">
          <p style="font-size:12px;line-height:1.5;color:{gris};margin:0 0 6px">{securite}</p>
          <p style="font-size:11px;line-height:1.5;color:{gris_clair};margin:0">{appli} · CFAO. Message automatique, merci de ne pas y répondre.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""


def _p(texte: str) -> str:
    return f'<p style="font-size:14px;line-height:1.6;color:{COULEURS["encre"]};margin:0 0 12px">{texte}</p>'


def _encadre(texte: str) -> str:
    c = COULEURS
    return (
        f'<div style="border-left:3px solid {c["marine"]};background:{c["fond_doux"]};'
        f'padding:10px 14px;font-size:13px;line-height:1.5;color:{c["encre"]}">{texte}</div>'
    )


def _etapes(lignes: list[str]) -> str:
    c = COULEURS
    rangs = "".join(
        f'<tr><td style="vertical-align:top;padding:0 12px 10px 0">'
        f'<div style="width:22px;height:22px;line-height:22px;text-align:center;background:{c["marine"]};'
        f'color:#ffffff;font-size:12px;font-weight:700">{i}</div></td>'
        f'<td style="vertical-align:top;padding:2px 0 10px;font-size:13px;line-height:1.5;color:{c["encre"]}">{ligne}</td></tr>'
        for i, ligne in enumerate(lignes, 1)
    )
    return f'<table role="presentation" cellpadding="0" cellspacing="0">{rangs}</table>'


def _composer(*, sujet: str, bandeau: str, titre: str, paragraphes: list[str], bouton: str,
              url: str, bloc: str, securite: str, apercu: str) -> str:
    """Les textes passés sont déjà échappés ; seule l'URL l'est ici."""
    return GABARIT.format(
        sujet=escape(sujet), apercu=apercu, cid=LOGO_CID, appli=escape(settings.APP_NAME),
        bandeau=bandeau, titre=titre, paragraphes="".join(_p(x) for x in paragraphes),
        bouton=bouton, url=escape(url, quote=True), url_lisible=escape(url), bloc=bloc,
        securite=securite, **COULEURS,
    )


def reinitialisation(lien: str, minutes: int) -> Courriel:
    sujet = f"{settings.APP_NAME} : réinitialisation du mot de passe"
    validite = f"Ce lien est valable {minutes} minutes et ne sert qu'une seule fois."
    securite = ("Vous n'êtes pas à l'origine de cette demande ? Ignorez ce message : "
                "votre mot de passe reste inchangé.")
    texte = (
        "Bonjour,\n\nPour choisir un nouveau mot de passe, ouvrez ce lien "
        f"(valable {minutes} minutes, usage unique) :\n{lien}\n\n"
        "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n"
    )
    html = _composer(
        sujet=sujet, bandeau="Mot de passe", titre="Réinitialiser votre mot de passe",
        paragraphes=[f"Une demande de nouveau mot de passe a été faite pour votre compte "
                     f"{escape(settings.APP_NAME)}. Cliquez sur le bouton pour en choisir un."],
        bouton="Choisir un nouveau mot de passe", url=lien, bloc=_encadre(validite),
        securite=securite, apercu=validite,
    )
    return Courriel(sujet, texte, html)


def invitation(adresse: str, email: str, jours: int) -> Courriel:
    """Explique l'usage unique du lien, pour éviter « ça ne marche plus » au 2e clic."""
    pluriel = "s" if jours > 1 else ""
    sujet = f"Votre accès à {settings.APP_NAME}"
    texte = "\n".join([
        "Bonjour,",
        "",
        f"Un accès à l'application {settings.APP_NAME} vous a été ouvert.",
        "",
        f"1. Cliquez sur ce lien personnel : {adresse}",
        f"   Il ne fonctionne qu'une seule fois et expire dans {jours} jour{pluriel}.",
        "2. Choisissez ensuite votre mot de passe (au moins 8 caractères).",
        f"3. Les fois suivantes, connectez-vous avec votre adresse ({email})",
        "   et ce mot de passe : le lien ne servira plus.",
        "",
        "Lien déjà utilisé ou expiré, mot de passe oublié : utilisez « Mot de passe oublié »",
        "sur la page de connexion, ou demandez un nouveau lien à l'administrateur.",
        "",
        "Ne transférez pas ce message : le lien ouvre votre compte.",
        "",
    ])
    m = escape(email)
    etapes = _etapes([
        f"Cliquez sur le bouton ci-dessus. Il ne fonctionne <strong>qu'une seule fois</strong> "
        f"et expire dans {jours} jour{pluriel}.",
        "Choisissez votre mot de passe (au moins 8 caractères).",
        f"Les fois suivantes, connectez-vous avec votre adresse <strong>{m}</strong> "
        "et ce mot de passe : le lien ne servira plus.",
    ])
    aide = _encadre("Lien déjà utilisé ou expiré, mot de passe oublié : utilisez "
                    "« Mot de passe oublié » sur la page de connexion, ou demandez "
                    "un nouveau lien à l'administrateur.")
    html = _composer(
        sujet=sujet, bandeau="Invitation", titre=f"Votre accès à {escape(settings.APP_NAME)}",
        paragraphes=[f"Un accès à l'application {escape(settings.APP_NAME)} vous a été ouvert. "
                     "Trois étapes pour commencer :"],
        bouton="Activer mon accès", url=adresse, bloc=etapes + '<div style="height:8px;font-size:0;line-height:0">&nbsp;</div>' + aide,
        securite="Ne transférez pas ce message : le lien ouvre votre compte.",
        apercu=f"Votre lien personnel, valable {jours} jour{pluriel}.",
    )
    return Courriel(sujet, texte, html)
