# Étude : recette du parcours complet (dépôt → vérification → publication)

## Besoin
Rejouer de bout en bout le fonctionnement actuel avant de retravailler l'écran de saisie :
1. Base avec historique publié (jusqu'à août 2026).
2. La paie dépose deux fichiers dans le dossier surveillé : `BrutFinal0926.csv` (propre : un départ,
   une arrivée, une mutation) et `BrutFinal1026.csv` (erreurs réalistes).
3. L'administrateur est prévenu (cloche + e-mail). **Un seul destinataire possible :
   `ibmbowou-ext@cfao.com`.**
4. Parcours admin sans publier : relevé des chiffres affichés (rien de nouveau ne doit apparaître).
5. Correction des erreurs dans la saisie, publication.
6. Second parcours : les chiffres affichés doivent correspondre aux attendus calculés depuis les fichiers.

## Existant
- Dossier surveillé : `app/imports/dossier.py` (`IMPORT_MODE=dossier`, `IMPORT_SCRUTATION_SECONDES`).
- Notification de réception : cloche seulement (`notifications.lot_recu`), alors que
  `etude-import-automatique.md` §6 prévoit aussi l'e-mail aux admins → **écart corrigé** ici.
- Envoi : point unique `mail.envoyer`. Aucun garde-fou sur les destinataires.
- Outils de recette : `tools/recette/reinit.py` (base fixe), `parcours-n2.mjs` (modèle de script),
  `frontend/e2e-recette/10-import.spec.ts` (sélecteurs de correction).

## Options
| Option | Pour | Contre |
|---|---|---|
| Spec Playwright dans `e2e-recette` | Intégrée à la CI de recette | Pas de vrai SMTP, pas de dossier surveillé réel, rapport peu lisible |
| **Script Node autonome** (modèle `parcours-n2.mjs`) | Lance API + front avec le vrai mode dossier, rapport chiffré lisible, réutilisable au réseau CFAO | Hors CI |

Choix : script autonome `tools/recette/parcours-complet.mjs` + générateur `tools/recette/fichiers_paie.py`.

## Sécurité des e-mails
- Nouveau réglage `MAIL_DESTINATAIRES_AUTORISES` (liste, vide = aucune limite) contrôlé dans
  `mail.envoyer` : toute autre adresse est refusée et journalisée, avant toute connexion SMTP.
- Base de recette : seul l'admin reçoit l'adresse `ibmbowou-ext@cfao.com` et `notif_mail = vrai` ;
  tous les autres comptes `notif_mail = faux`. Double protection.

## Impacts
Pas de migration. Réglage nouveau facultatif. Mail de réception : seulement si SMTP configuré et
admin abonné aux e-mails.

## Risques
- SMTP joignable uniquement sur le réseau CFAO : sans lui, le parcours tourne et note « e-mail non
  envoyé ».
- Les erreurs volontaires dépendent des contrôles actuels : le rapport liste ce qui est réellement
  détecté, sans le supposer.
