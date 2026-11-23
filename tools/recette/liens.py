# ruff: noqa: E501 - gabarit de mail : le HTML reste sur une ligne par bloc
"""Mail d'invitation avec un lien de connexion directe par compte (démo, invitation).

Usage (depuis backend/) : .venv/Scripts/python ../tools/recette/liens.py --base demo-n2.db
Options : --url (adresse publique ; défaut : ../reporting-rh-test/adresse.txt), --jours 14,
--sortie (fichier HTML ; défaut : tools/recette/mail-liens.local.html, non suivi).

Les anciens liens de la base sont révoqués : seuls ceux du dernier mail ouvrent une session.
Le fichier produit contient des liens actifs et des noms réels : il ne se pousse jamais.
"""

import argparse
import html
import os
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

from generer_comptes import charger

ICI = Path(__file__).resolve().parent
BACKEND = ICI.parent.parent / "backend"
ADRESSE = ICI.parent.parent.parent / "reporting-rh-test" / "adresse.txt"
MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
        "septembre", "octobre", "novembre", "décembre"]

BLEU, ENCRE, GRIS, LIEN, FOND = "#2a3157", "#0e1126", "#6b6f82", "#1c4fa0", "#f5f5f5"
TD = "padding:7px 10px;border-top:1px solid #e7e7ea;vertical-align:top;"
GROUPES = ("Administration", "Direction", "Responsables de service")


def _liste(noms: list[str]) -> str:
    return noms[0] if len(noms) == 1 else ", ".join(noms[:-1]) + " et " + noms[-1]


def _mois(a: int, m: int) -> str:
    return f"{MOIS[m - 1]} {a}"


def _ligne(c: dict, services: list[str], url: str) -> tuple[str, str]:
    """(groupe, <tr>) d'un compte."""
    fonction = c["fonction"] or c["nom"]
    if c["modele"] == "perimetre" and fonction in services:
        fonction = f"Responsable {fonction}"
    if c["modele"] == "admin":
        groupe, voit = GROUPES[0], "Tout, avec l'import des fichiers et la gestion des comptes"
    elif c["modele"] == "global":
        groupe = GROUPES[1]
        voit = "Tous les services" + (
            ", avec les noms des salariés (page Individuel)" if c["nominatif"] == "oui" else "")
    else:
        groupe = GROUPES[1] if len(services) > 1 else GROUPES[2]
        voit = _liste(services) if services else "Son périmètre"
    nom = "" if c["nom"].startswith(("Responsable", "Administration")) else c["nom"]
    qui = html.escape(fonction, False) + (
        f'<br><span style="color:{GRIS};font-size:12px;">{html.escape(nom, False)}</span>' if nom else "")
    bouton = (f'<a href="{html.escape(url)}" style="color:{LIEN};font-weight:bold;">'
              "Se connecter</a>")
    return groupe, (f'<tr><td style="{TD}">{qui}</td><td style="{TD}white-space:nowrap;">'
                    f'{bouton}</td><td style="{TD}">{html.escape(voit, False)}</td></tr>')


def _mail(lignes: dict[str, list[str]], adresse: str, expire: datetime,
          debut: tuple[int, int], fin: tuple[int, int]) -> str:
    entete = "".join(
        f'<th align="left" bgcolor="{BLEU}" style="background:{BLEU};color:#ffffff;'
        f'padding:8px 10px;">{t}</th>'
        for t in ("Fonction", "Connexion directe", "Ce que le compte voit"))
    corps = ""
    for g in GROUPES:
        if lignes.get(g):
            corps += (f'<tr><td colspan="3" bgcolor="#e6eefc" style="background:#e6eefc;'
                      f'color:{LIEN};font-weight:bold;padding:6px 10px;'
                      f'border-top:1px solid #cfd0d8;">{g}</td></tr>' + "".join(lignes[g]))
    hote = html.escape(adresse.split("://", 1)[-1])
    lien = html.escape(adresse)
    jusquau = f"{expire.day} {MOIS[expire.month - 1]} {expire.year}"
    suivant = (fin[0], fin[1] + 1) if fin[1] < 12 else (fin[0] + 1, 1)
    return f"""<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><title>Invitation au test Reporting RH</title></head>
<body>
<table role="presentation" width="680" cellpadding="0" cellspacing="0" border="0" style="width:680px;max-width:100%;border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:14px;line-height:1.5;color:{ENCRE};background:#ffffff;border:1px solid #e7e7ea;">
<tr><td bgcolor="{BLEU}" style="background:{BLEU};padding:24px 28px;color:#ffffff;">
  <div style="font-size:12px;letter-spacing:1px;color:#cfd0d8;">VERSION DE TEST</div>
  <div style="font-size:24px;font-weight:bold;color:#ffffff;">Reporting RH</div>
</td></tr>
<tr><td style="padding:24px 28px 8px 28px;">
  <p style="margin:0 0 12px 0;">Bonjour,</p>
  <p style="margin:0;">La version de test de l'application Reporting RH est prête et je vous invite à l'essayer. Plus besoin d'adresse ni de mot de passe : chaque compte ci-dessous a son lien de connexion directe. Vos retours nous aideront à finaliser l'outil avant sa mise en service.</p>
</td></tr>
<tr><td style="padding:12px 28px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:{FOND};border-left:4px solid {BLEU};">
    <tr><td style="padding:14px 16px 4px 16px;width:150px;color:{GRIS};">Connexion</td><td style="padding:14px 16px 4px 0;">un clic sur <b>Se connecter</b>, en face de la fonction choisie</td></tr>
    <tr><td style="padding:4px 16px;color:{GRIS};">Liens valables</td><td style="padding:4px 16px 4px 0;">jusqu'au <b>{jusquau}</b></td></tr>
    <tr><td style="padding:4px 16px 14px 16px;color:{GRIS};">Application</td><td style="padding:4px 16px 14px 0;"><a href="{lien}" style="color:{LIEN};font-weight:bold;">{hote}</a></td></tr>
  </table>
</td></tr>
<tr><td style="padding:20px 28px 0 28px;">
  <div style="font-size:16px;font-weight:bold;color:{BLEU};">Comptes de test</div>
  <p style="margin:2px 0 10px 0;color:{GRIS};">Chaque compte montre ce que verra la personne qui occupe cette fonction.</p>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-size:13px;border:1px solid #cfd0d8;">
    <tr>{entete}</tr>
    {corps}
  </table>
</td></tr>
<tr><td style="padding:20px 28px 0 28px;">
  <div style="font-size:16px;font-weight:bold;color:{BLEU};">À savoir</div>
  <ul style="margin:6px 0 0 0;padding-left:20px;">
    <li>Les montants sont fictifs, de {_mois(*debut)} à {_mois(*fin)}. Les comptes sont ceux des vraies fonctions.</li>
    <li>Pour changer de compte : menu du profil en haut à droite, « Déconnexion », puis un autre lien.</li>
    <li>Ces liens ouvrent une session sans mot de passe : merci de ne pas transférer ce mail.</li>
    <li>L'import se teste avec un compte administrateur et les fichiers joints. Les mois à partir de {_mois(*suivant)} sont libres pour cet essai.</li>
    <li>Le site peut être momentanément indisponible. Si l'adresse change, je vous envoie de nouveaux liens.</li>
  </ul>
</td></tr>
<tr><td style="padding:20px 28px 0 28px;">
  <div style="font-size:16px;font-weight:bold;color:{BLEU};">Vos retours</div>
  <p style="margin:6px 0 0 0;">Merci de m'indiquer pour chaque remarque la page concernée, le compte utilisé et ce que vous avez constaté, avec une capture si possible.</p>
</td></tr>
<tr><td style="padding:20px 28px 24px 28px;">
  <p style="margin:0 0 12px 0;">Merci d'avance pour votre participation.</p>
  <p style="margin:0;">Cordialement,<br><b>Ibrahim Mbowou</b></p>
</td></tr>
</table>
</body>
</html>
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="recette.db", help="fichier SQLite (relatif à backend/)")
    ap.add_argument("--url", help="adresse publique de l'application")
    ap.add_argument("--jours", type=int, default=14)
    ap.add_argument("--sortie", default=str(ICI / "mail-liens.local.html"))
    args = ap.parse_args()
    adresse = args.url or (ADRESSE.read_text(encoding="utf-8").strip() if ADRESSE.exists() else "")
    if not adresse.startswith("http"):
        sys.exit("adresse publique inconnue : --url https://...")
    pg = args.base.startswith("postgresql")
    base = Path(".") if pg else (BACKEND / args.base).resolve()
    if not pg and not base.exists():
        sys.exit(f"{base} introuvable : lancer d'abord reinit.py")
    sortie = Path(args.sortie).resolve()
    comptes = charger()
    os.environ.update(DATABASE_URL=args.base if pg else f"sqlite:///{base.as_posix()}", ENV="test")
    os.chdir(BACKEND)
    sys.path.insert(0, str(BACKEND))

    from sqlalchemy import Integer, func, literal, select

    from app.db.session import SessionLocal
    from app.models.auth import Perimetre, PerimetreRegle, Utilisateur
    from app.models.donnees import Periode, SituationMensuelle
    from app.security import liens

    with SessionLocal() as db:
        cle = Periode.annee * literal(100, Integer) + Periode.mois
        bornes = db.execute(select(func.min(cle), func.max(cle))
                            .join(SituationMensuelle)).one()
        if bornes[0] is None:
            sys.exit("aucune période de paie dans la base")
        debut, fin = divmod(bornes[0], 100), divmod(bornes[1], 100)
        revoques = liens.revoquer(db)
        lignes: dict[str, list[str]] = {}
        for c in comptes:
            email = c["email"].strip().lower()
            user = db.scalar(select(Utilisateur).where(Utilisateur.email == email))
            if user is None or not user.actif:
                sys.exit(f"{email} absent ou inactif dans {base.name}")
            services = list(db.scalars(
                select(PerimetreRegle.valeur).join(Perimetre)
                .where(Perimetre.code == c["perimetre"], PerimetreRegle.dimension == "service")
                .order_by(PerimetreRegle.id))) if c["perimetre"] else []
            url = liens.url(adresse, liens.creer(db, user, args.jours))
            groupe, tr = _ligne(c, services, url)
            lignes.setdefault(groupe, []).append(tr)
        db.commit()
    expire = datetime.now(UTC) + timedelta(days=args.jours)
    sortie.write_text(_mail(lignes, adresse, expire, debut, fin), encoding="utf-8")
    print(f"{len(comptes)} lien(s) créé(s), {revoques} ancien(s) révoqué(s), "
          f"valables {args.jours} jours.")
    print(f"Mail : {sortie} (liens actifs, ne pas pousser)")


if __name__ == "__main__":
    main()
