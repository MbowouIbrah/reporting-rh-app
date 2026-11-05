# Revue : changement de mot de passe obligatoire

Passe 1 : aucun écart bloquant, aucune route ne contourne le blocage. Plafond : deux passes.
Statuts : `à corriger`, `corrigé`, `différé (raison)`, `rejeté (raison)`. N° 2 et n° 10 : clos par I1 et I2 de la passe 2.

## Importants

| N° | Où | Classe | Correction décidée | Statut |
|---|---|---|---|---|
| 1 | `backend/app/api/auth.py:169-171`, `frontend/src/pages/Reinitialiser.tsx:40-41` | Second chemin de levée du drapeau sans contrôle : le lien e-mail accepte le mot de passe posé par l'admin | Refus 422 si nouveau = actuel, message affiché, test | corrigé |
| 2 | `frontend/nginx.conf:11-16`, `docs/RUNBOOK.md:8,25` | Limite de débit commune à tous derrière le proxy | `set_real_ip_from` sur les plages privées (10/8, 172.16/12, 192.168/16), `real_ip_header X-Forwarded-For`, `real_ip_recursive on` ; le port web reste lié à 127.0.0.1 ; test à deux adresses sur la vraie pile, RUNBOOK | corrigé |
| 3 | `backend/app/seed.py:38,77-90,98`, `backend/app/models/auth.py:60` | Défaut permissif | `provisoire=True` par défaut, drapeau transmis aux comptes de démo, `--demo` refusé si `ENV=prod`, longueur contrôlée, défaut du modèle à `True` (les tests et outils passent déjà `False`, à vérifier) | corrigé |
| 4 | `0022_mot_de_passe_provisoire.py:17-19`, `backend/app/comptes.py`, `docs/RUNBOOK.md` | Comptes existants non couverts | Commande `exiger-changement EMAIL`, étape de mise à niveau au RUNBOOK | corrigé |

## Mineurs

| N° | Où | Classe | Correction décidée | Statut |
|---|---|---|---|---|
| 5 | `backend/app/api/admin.py:246-249,258` | Contrôle manquant, session perdue | Un admin ne change plus son propre mot de passe depuis Utilisateurs : 422 et renvoi vers `/auth/changer-mot-de-passe` ; front aligné | corrigé |
| 6 | `backend/app/api/admin.py:134-148`, `backend/app/comptes.py:107` | État sans affichage | Drapeau dans `_user_dict` et `lister` | corrigé |
| 7 | `frontend/src/pages/admin/Utilisateurs.tsx:343` | État sans affichage | Ligne d'aide « provisoire », badge si le drapeau est posé | corrigé |
| 8 | `frontend/src/api/client.ts:57`, `frontend/src/auth/AuthContext.tsx:56` | État périmé | Revalider `['me']` sur le code `mot_de_passe_a_changer` | corrigé |
| 9 | `frontend/src/auth/AuthContext.tsx:78-90,145` | Condition de course | Numéroter les vérifications, relancer si un message arrive en vol | corrigé |
| 10 | `frontend/src/auth/RequireAuth.tsx:13` | Perte de contexte | Transmettre `next`, validé comme à la connexion | corrigé |
| 11 | `frontend/src/api/types.ts:70` | Champ optionnel | Rendre `doit_changer_mdp` obligatoire, adapter les fixtures | corrigé |
| 12 | `ChangerMotDePasse.tsx:24,53`, `Reinitialiser.tsx:27,75` | Valeur en dur | Constante partagée côté front | corrigé |
| 13 | `backend/app/security/passwords.py:6,17` | Politique faible | Refuser un mot de passe fait seulement d'espaces et au-delà de 72 octets, tests | corrigé |
| 14 | `backend/app/api/auth.py:193-194` | Traçabilité | Journaliser le refus pour mot de passe identique | corrigé |
| 15 | `0022_mot_de_passe_provisoire.py:22-24` | Perte d'état | Note au RUNBOOK : descendre puis remonter efface les drapeaux | corrigé |
| 16 | `backend/app/seed.py:40-41`, `backend/entrypoint.sh:5` | Recréation de l'admin | Créer l'admin seulement si aucun compte gestionnaire actif n'existe, test | corrigé |
| 17 | `tools/e2e_seed.py:14,34-37` | Outil non gardé | Exiger SQLite, comme `tools/recette/reinit.py:135` | corrigé |
| 18 | `backend/.dockerignore` | Tests dans l'image | Exclure `tests` ; vérifier que `Dockerfile.test` n'en dépend pas | corrigé |
| 19 | `backend/tests/test_comptes.py`, `test_changement_mdp.py:67,97`, `auth.py:199-200` | Tests manquants | Drapeau sur `creer` et `mot-de-passe`, refresh de l'autre session, « rester connecté », parcours de toutes les routes sans filtre `/api/` | corrigé |
| 20 | `frontend/nginx.conf:7`, `docs/RUNBOOK.md:13,17-18,20-21,23`, `backend/app/comptes.py:3`, `frontend/src/App.tsx:97` | Documentation périmée | `--modele`, `droits`, écran Utilisateurs, mot de passe provisoire | corrigé |

## Non vérifié en passe 1, à prouver sur la vraie pile

Migration 0022 sur PostgreSQL ; limite, CSP et proxy nginx ; navigateur à plusieurs onglets ; `COOKIE_PATH_PREFIX` absent de `docker-compose.yml` : exemple de sous-chemin retiré du RUNBOOK, ce mode n'est plus prévu. Prouvé depuis : 0022 sur PostgreSQL, limite, CSP. Plusieurs onglets : profil périmé corrigé dans `frontend/src/auth/AuthContext.tsx`, test qui échoue sans le correctif.

## Passe 2 (contre-revue) : 0 bloquant, 2 importants, 9 mineurs

| N° | Lieu | Classe | Correction | Statut |
|---|---|---|---|---|
| I1 | `frontend/nginx.conf`, `docs/RUNBOOK.md:8,25` | Limite contournable | `real_ip_recursive off` : seule l'adresse ajoutée par le proxy compte. Clôt le n° 2 | corrigé, prouvé sur la vraie pile : 429 même avec un en-tête `X-Forwarded-For` forgé (proxy simulé par l'en-tête) |
| I2 | `frontend/src/lib/connexion.ts` | Redirection ouverte | Adresse lue par `new URL` comme le navigateur. Clôt le n° 10 | corrigé |
| M1 | `frontend/src/lib/connexion.ts` | Boucle de pages | Pages de connexion refusées comme cible | corrigé |
| M2 | `backend/app/seed.py` | Règle en double | Mots de passe d'amorçage passés par `check_password` | corrigé |
| M3 | `backend/app/seed.py`, `docs/RUNBOOK.md:21` | Échec silencieux | Avertissement si `ADMIN_EMAIL` existe sans droit | corrigé |
| M4 | `backend/app/comptes.py`, `docs/RUNBOOK.md:21,23` | Libellé inexact | Blocage immédiat décrit comme tel | corrigé |
| M5 | `frontend/src/pages/ChangerMotDePasse.tsx` | Libellé inexact | « Mot de passe provisoire » au lieu de « Première connexion » | corrigé |
| M6 | `.env.example` | Doublon, avertissement absent | Ligne en double retirée, `WEB_BIND=0.0.0.0` déconseillé | corrigé |
| M7 | `frontend/src/pages/Reinitialiser.test.tsx` | Test manquant | Refus 422 affiché | corrigé |
| M8 | `frontend/src/pages/admin/Utilisateurs.tsx` | Aide fugace | Aide sous le champ, plus dans le placeholder | corrigé |
| M9 | `frontend/src/pages/ChangerMotDePasse.tsx` | État sans affichage | Confirmation et lien « Continuer » après un changement volontaire | corrigé |
