# Étude : page de connexion reprise de cfaoacademy

Date : 2026-10-21. Branche : `securite-connexion`.

## 1. Besoin
- Reprendre la page de connexion du projet cfaoacademy (`Projets/cfaoacademy/frontend/src/pages/Login.jsx`) et ses fonctions : mot de passe oublié et options d'authentification.
- Mots de passe : 8 caractères minimum partout (validé le 21/10).

## 2. Existant
| Élément | Reporting RH | cfaoacademy |
|---|---|---|
| Mise en page | Fond photo (`Fond.tsx`) + carte en verre, logo, titre | Fond photo + carte en verre, deux panneaux qui glissent (connexion / oubli) |
| Champs | E-mail, mot de passe | Identifiant, mot de passe avec bouton œil |
| Options | Aucune | « Se souvenir de moi », « Mot de passe oublié ? », SSO Microsoft / Google désactivés (« Bientôt »), ligne de contact |
| Mot de passe oublié | Absent | Simulé côté front (aucun envoi réel) |
| Back | `/auth/login`, `/refresh`, `/logout`, `/me` ; cookies httponly ; JWT `typ` | — |
| E-mail | Aucun envoi (B-004 à faire) | — |

## 3. Options
| Option | Pour | Contre |
|---|---|---|
| A. Copier seulement l'apparence | Rapide | « Mot de passe oublié » factice : trompeur pour l'utilisateur |
| B. Apparence + vraies fonctions (oubli par e-mail, se souvenir de moi) | Fonctions réelles, sûres | Besoin d'un serveur SMTP pour l'envoi |
| C. B + SSO réel (Keycloak, Microsoft) | Complet | Hors périmètre (backlog B-001), dépend de l'annuaire du client |

## 4. Choix : B
- **Page** : mise en page cfaoacademy avec les jetons du projet (angles droits, rayon 8 px sur les boutons). Sans tiroir de profils de démo.
- **SSO** : boutons Microsoft et Google affichés désactivés, badge « Bientôt » (B-001).
- **Bouton œil** sur le mot de passe.
- **Se souvenir de moi** : décoché → cookies de session (fermés avec le navigateur) ; coché → session de `REFRESH_TOKEN_DAYS` jours. Le choix est gardé dans le jeton de rafraîchissement (`rem`).
- **Mot de passe oublié** :
  - `POST /auth/mot-de-passe-oublie {email}` répond toujours la même chose (on ne révèle pas si le compte existe) ; une demande au plus toutes les 5 min par compte ; audit `reinit_demande`.
  - Lien `…/reinitialiser#jeton=…` (fragment : jamais envoyé au serveur ni écrit dans les journaux d'accès) : JWT `typ=reset`, 30 min, lié à l'empreinte du mot de passe actuel → utilisable une seule fois.
  - `POST /auth/reinitialiser {jeton, password}` : 8 caractères minimum ; audit `reinit_mdp`.
  - Les jetons de rafraîchissement portent aussi l'empreinte : changer le mot de passe ferme les autres sessions.
- **Envoi** : SMTP configurable (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_TLS`, `APP_URL`). Sans SMTP : le lien est écrit dans le journal du serveur hors production ; en production rien n'est envoyé (audit `reinit_non_envoye`).

## 5. Impacts
- Données : aucune migration (empreinte calculée à partir du hash existant).
- Sécurité : réponses neutres, jeton court à usage unique, limite de fréquence, sessions fermées après changement.
- Déploiement : variables SMTP à renseigner (RUNBOOK).

## 6. Risques
- Sans SMTP en production, l'utilisateur ne reçoit rien : l'administrateur garde la réinitialisation depuis la page Utilisateurs.

## 7. Point à trancher par le client
- Serveur SMTP et adresse d'expédition à fournir.
