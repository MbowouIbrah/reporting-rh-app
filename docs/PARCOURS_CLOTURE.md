# Parcours de clôture mensuelle (plan 07)

Écran unique « Clôture du mois », piloté par `GET /cloture?annee&mois`. Statuts calculés côté serveur depuis les tables existantes et `audit_event` : aucune nouvelle table, aucune migration. Seule confirmation manuelle : « Effectifs à jour » (événement d'audit `confirmation_effectifs`).

Trous actuels : un mois ne peut pas être ouvert sans import (`Periode` créée seulement dans `imports/service.py`) ; `cloturer` (`api/periodes.py`) ne vérifie aucun prérequis.

## Étapes (accès libre à toutes)

| # | Étape | Dépend de | Statut |
|---|---|---|---|
| 1 | Mois : créer/choisir (`POST /periodes`) | — | Fait si la période existe ; close = lecture seule |
| 2 | Effectifs (écran Employés) | 1 | À revoir si fiche incomplète ou changement postérieur à la confirmation ; Fait si confirmé et inchangé |
| 3 | Données de paie (modèle, import, saisie) | 2 | À faire si 0 ligne ; À revoir si lot en attente, actif sans ligne, ligne d'inactif, ou effectifs modifiés après le dernier import |
| 4 | Contrôles (synthèse + `controles` du moteur) | 3 | À revoir si un contrôle bloquant ; calcul à la volée |
| 5 | CA du mois | 1 | Fait si saisi, sinon « Reportable » (sans blocage) |
| 6 | Budgets détaillés | 1 | Fait si une ligne, sinon « Facultatif » |
| 7 | Clôture | 2, 3, 4 | Bloquée tant que 2, 3, 4 ne sont pas Fait ; CA/budget absents : avertissement |

Étape courante = première étape obligatoire non « Fait ».

## Retours en arrière
- Période ouverte : tout se rouvre librement. Changer les effectifs après import ne modifie pas les données du mois (instantané) : l'étape 3 passe « À revoir » (réimporter ou corriger une ligne). CA et budgets n'invalident rien.
- Période close : lecture seule ; réouverture avec motif (≥ 5 car.) et audit ; bandeau « Rouverte le … par … : motif ». Rouvrir M-1 alors que M est clos renvoie `impacts` (mois suivants clos), avertissement sans blocage.

## Interface
`/admin/cloture?periode=AAAA-MM&etape=…` ; stepper horizontal 7 pastilles, contenu défilant, barre d'actions en bas, tient dans 100vh (`.ecran-admin`). Onglets : Clôture du mois · Employés · Accès (« Périodes et CA » et « Données mensuelles » absorbés, anciennes URLs redirigées).

## Tranches (un commit `07-x` chacune)
- 07a : `POST /periodes` (ouvrir un mois, 409 si existant, audit).
- 07b : `repos/cloture.py` (`etat_parcours`) + `api/cloture.py` (`GET /cloture`, `POST /cloture/{pid}/effectifs/confirmer`) + tests.
- 07c : garde-fous de `cloturer` (409 + bloquants) et `impacts` à la réouverture ; adapter les tests existants.
- 07d : API/hooks front (`useParcours`, `useOuvrirMois`, `useConfirmerEffectifs`).
- 07e : extraire les contenus réutilisables (DonneesMois, SaisieCa, BudgetsMois, GestionEmployes), sans changement visuel.
- 07f : `Cloture.tsx` + `Stepper.tsx` + tests.
- 07g : navigation (3 onglets), redirections, e2e du parcours complet.
- 07h : pytest, ruff, build, tests, Playwright, axe, captures 1440×800 et 1280×720.

## Points de vigilance
- `Salarie.actif` non daté : la règle de couverture n'est fiable que pour le mois ouvert le plus récent ; informatif pour les mois antérieurs.
- Vérifier l'étape 4 sur PostgreSQL (floats SQLite).
- Vérifier qu'un salarié créé par `valider_lot` produit un événement d'audit ; sinon compter aussi `import_valide`.
- Durcir `cloturer` change un comportement existant : adapter tests et e2e dans la même tranche.

## Décisions (défauts retenus)
1. CA tardif sur mois clos : garder le verrou ; l'étape 5 propose « Rouvrir pour saisir le CA » (motif pré-rempli).
2. Clôturer M quand M-1 est ouvert : avertissement, sans blocage.
