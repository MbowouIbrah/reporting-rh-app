# Étude : aucune adresse ni mot de passe dans le dépôt

Validée le 2026-11-06.

## Besoin
Aucune adresse e-mail ni aucun mot de passe dans le dépôt, historique compris. Les comptes par défaut et les données de test sont définis en local, hors suivi. Un guide explique comment les générer.

## Existant
- `tools/recette/comptes.csv` : 10 adresses. La règle de mot de passe (début de l'adresse + un suffixe fixe) est écrite dans `reinit.py`, `LISEZMOI.md` et `e2e-recette/outils.ts`.
- `backend/app/seed.py --demo` : 8 adresses en dur, réutilisées par les tests.
- Tests (pytest, vitest, Playwright) : environ 150 adresses sur deux domaines d'exemple dans 40 fichiers, une dizaine de mots de passe et deux clés secrètes écrits en dur.
- `PASSATION.md` : chemins locaux, compte et mot de passe de mesure.
- Auteurs des commits : adresse gmail et adresse professionnelle.

## Options
| Option | Pour | Contre |
|---|---|---|
| Garder le domaine d'exemple réservé (pratique courante) | Aucun travail | Refusé : des adresses restent écrites |
| Une seule fonction fabrique les adresses de test, domaine `exemple.invalid` (RFC 2606) | Une seule ligne ; aucune boîte ne peut exister | 40 fichiers à reprendre |
| Comptes de recette générés en local (`comptes.local.csv`, ignoré) | Rien de personnel suivi ; mots de passe aléatoires | Une étape de plus, automatique au lancement |

## Choix
1. Tests : `courriel(nom)` (`backend/tests/identites.py`, `frontend/e2e/identites.ts`, `frontend/src/test/identites.ts`, `e2e-recette/outils.ts`). Mots de passe et clés secrètes tirés au hasard à chaque lancement.
2. Recette : `comptes.exemple.csv` (profils, identifiant sans domaine). `generer_comptes.py` crée `comptes.local.csv` avec l'adresse et un mot de passe aléatoire. `reinit.py` et Playwright l'utilisent.
3. `seed.py --demo` : adresses construites à partir de `DEMO_DOMAINE` (environnement local).
4. `PASSATION.md` n'est plus suivi.
5. Historique : `git filter-repo` dans un clone neuf de `publication`. Remplacement des textes, retrait de `comptes.csv`, auteurs passés à l'adresse noreply GitHub. Contrôle par scan complet avant l'envoi.
6. Guide : `docs/DONNEES_DE_TEST.md`.

## Risques
- Les valeurs volontairement refusées (« court », mot de passe trop long) restent dans les tests de règle : ce ne sont les mots de passe d'aucun compte.
- La base de recette se construit depuis un fichier d'import qui contient des données réelles, jamais suivi. Sans ce fichier, seule la base e2e (100 % fictive) est disponible.
