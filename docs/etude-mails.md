# Étude : mails de l'application

## Besoin
Mails texte bruts, sans identité visuelle. Les mettre aux couleurs de l'application, sur le modèle de Précis (gabarit HTML + version texte, logo embarqué), en commençant par l'authentification.

## Existant
- `app/mail.py` : envoi SMTP texte seul.
- Mails d'authentification : réinitialisation du mot de passe (`api/auth.py`), invitation par lien personnel (`comptes.py lien --envoyer`).
- Autres mails : alertes de `app/notifications.py` (texte), à traiter ensuite.

## Choix
- `app/mail_modeles.py` : textes et mise en page (un `Courriel` = sujet + texte + HTML) ; `app/mail.py` ne fait qu'envoyer.
- HTML en tableaux et styles en ligne (seul rendu fiable Outlook / Gmail / Apple Mail), couleurs de `tokens.css`, angles droits, bouton à rayon 8 px.
- Logo CFAO joint en `cid:` (multipart/related, disposition inline) : une image distante est bloquée par défaut et sert de mouchard. Copie dans `backend/app/assets/` pour ne pas dépendre du frontend au déploiement.
- Version texte toujours jointe (messageries sans HTML, filtres anti-spam).
- En-têtes `Auto-Submitted` et `X-Auto-Response-Suppress` : pas de réponse automatique.
- Expéditeur affiché : « Reporting RH <SMTP_FROM> ».

## Reste
- Passer les alertes de `notifications.py` sur le même gabarit.
