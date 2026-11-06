# Base de recette

Mêmes données à chaque passage : on réinitialise avant chaque test de profil.

## Réinitialiser

1. Arrêter l'API.
2. Depuis `backend/` : `.venv/Scripts/python ../tools/recette/reinit.py` (environ 1 min).
3. Relancer l'API sur la base de recette :
   `DATABASE_URL=sqlite:///recette.db ENV=test COOKIE_SECURE=false SECRET_KEY=<clé aléatoire> .venv/Scripts/python -m uvicorn app.main:app --port 8100`
   (clé aléatoire : `python -c "import secrets; print(secrets.token_urlsafe(48))"`)

L'historique contient aussi une activité fictive (`activite_fictive.py`) : ventes, clients, CA et marge individuels en front office, indice de productivité en back office SAV.
Pour l'ajouter à un fichier d'import : `python tools/recette/activite_fictive.py <source.xlsx> <sortie.xlsx>`.

Comptes : `comptes.exemple.csv` (suivi) décrit les profils par identifiant, sans adresse. `generer_comptes.py` en tire `comptes.local.csv` (ignoré par git) : adresse `<identifiant>@RECETTE_DOMAINE` (défaut `exemple.invalid`) et mot de passe = identifiant + `RECETTE_SUFFIXE` (suffixe choisi en local), sinon aléatoire par compte. Le fichier est créé automatiquement par `reinit.py` et par la recette Playwright s'il manque ; `python tools/recette/generer_comptes.py --force` le régénère (puis relancer `reinit.py`). Comptes locaux de recette, jamais en production.

## Fichiers

| Fichier | Contenu |
|---|---|
| `comptes.exemple.csv` | Un compte par profil : identifiant, fonction (libellé affiché), modèle de droits (`admin`, `global`, `perimetre`), périmètre, nominatif. |
| `comptes.local.csv` | Généré, non suivi : identifiant, adresse, mot de passe et colonnes du fichier précédent. |
| `ca_marge.csv` | CA et marge de janvier 2024 à octobre 2026 (marge négative, CA sans marge, mois non saisi, décimales). |
| `budgets.csv` | Quelques budgets 2024-2025, budgets de mai (services) et juin 2026 (services, sites, toutes les rubriques payées en juin : budgets par famille salaire / primes / avantages / charges affichés), au-dessus et en dessous du réel. |

L'historique est 100 % fictif (`donnees_fictives.py`, graine fixe) : 98 salariés sur 7 services, de janvier 2024 au dernier mois clos (`--fin AAAA-MM` pour changer). Il couvre entrées, sorties, pause, changements de service, de site, de contrat et de poste, stages, régularisation négative, absences, primes saisonnières ; la liste des cas s'affiche à la fin.
La recette Playwright s'arrête à juin 2026 (`--fin 2026-06`) : juillet et août sont importés en direct (`fichier_erreurs.py`).

## Ce que chaque profil doit voir

| Compte | Doit voir | Ne doit pas voir |
|---|---|---|
| admin, rh.partenaire | Tout + import, pilotage, comptes | — |
| drh (DRH), dop (DOP) | Tous les services, noms des salariés | Import, pilotage, comptes |
| dps (DPS) | Commerce Pièces, SAV PL, SAV Engins, Sites Déportés | Autres services, noms |
| commerce.vn | Commerce VN (EMP015 jusqu'en décembre 2025) | Autres services, noms |
| pneumatique | Pneumatique | Autres services, noms |
| sav.pl | SAV PL (EMP015 dès janvier 2026) | Autres services, noms |
| resp.sav.engins | SAV Engins | Autres services, noms |
| sites.deportes | Sites Déportés | Autres services, noms |

## Vérification automatique

Depuis `frontend/` : `npx playwright test -c playwright.recette.config.ts` (environ 1 min, ports 8101 et 5181).
Réinitialise la base, puis parcourt chaque compte : onglets, marge, services visibles, contrôles de cohérence,
Individuel, Administration, refus de l'API, déconnexion ; plus un mauvais mot de passe.
Parcours de l'administrateur à l'écran, avec leurs effets (rapports, journal d'audit, API) : import avec erreurs puis
corrigé (juillet), import et réimport d'août, CA / marge / budgets, employés, utilisateurs et périmètres, correction
d'une valeur par la saisie, refus d'écriture aux lecteurs (drh, dps). Les fichiers viennent de `fichier_erreurs.py`.
Ces parcours remplissent juillet et août et ajoutent comptes et employés de test : `reinit.py` repart de zéro.

À savoir pour la démo : les filtres sont partagés entre les pages. Un service choisi sur Mensuel reste actif
sur Individuel (« Matricule introuvable » si l'employé n'en fait pas partie) : « Réinitialiser les filtres ».
