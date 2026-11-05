# Étude : changement de mot de passe obligatoire

## Besoin
Un seul compte par défaut (admin fictif). Son mot de passe initial n'est qu'un mot de passe provisoire : il doit être changé à la première connexion, avant tout accès aux données.

## Existant
- Le démarrage crée déjà un seul admin (`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `app/seed.py`) ; les comptes de démo exigent `--demo`.
- Toutes les routes protégées passent par `current_principal` (`app/security/deps.py`).
- Le jeton de session contient une empreinte du mot de passe : un changement ferme les autres sessions.
- Aucune route ne permet à un utilisateur connecté de changer son mot de passe.

## Options
| Option | Pour | Contre |
|---|---|---|
| Blocage côté écran seul | Très simple | L'API reste ouverte : refusé |
| Pas de session tant que le mot de passe n'est pas changé (jeton dédié) | Aucune session complète | Second parcours de connexion, plus de code |
| **Drapeau sur le compte, contrôlé dans `current_principal`** | Une seule porte, couvre les futures routes | Deux routes à ouvrir explicitement |

## Choix
Champ `utilisateur.doit_changer_mdp`, migration `0022`, faux pour les comptes existants.

- Drapeau actif : toute route protégée répond 403 avec le code `mot_de_passe_a_changer`. Restent ouverts : `/auth/me`, `/auth/changer-mot-de-passe`, `/auth/refresh`, `/auth/logout`.
- `POST /auth/changer-mot-de-passe` exige le mot de passe actuel, refuse un mot de passe identique, efface le drapeau, écrit au journal et repose les cookies.
- Un test parcourt toutes les routes : une route ajoutée plus tard est bloquée par défaut.

| Mot de passe posé par | Drapeau |
|---|---|
| Démarrage (admin par défaut) | Actif, jamais réactivé au redémarrage |
| Un admin sur un autre compte, ou l'outil `app.comptes` | Actif : la personne seule doit connaître son mot de passe |
| L'admin sur son propre compte | Inactif |
| La personne, par lien de réinitialisation ou par la nouvelle route | Effacé |

## Impacts
- Données : une colonne, sans reprise.
- Sécurité : un mot de passe actuel faux répond 400 et non 401, pour ne pas déclencher le renouvellement de session côté page. La route rejoint la limite de connexion de nginx.
- Déploiement : `ADMIN_PASSWORD` reste à fournir à l'installation, jamais dans le dépôt.

## Risques
- Sans SMTP, un admin qui perd son mot de passe provisoire passe par `python -m app.comptes`.
