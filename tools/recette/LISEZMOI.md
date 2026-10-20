# Base de recette

Mêmes données à chaque passage : on réinitialise avant chaque test de profil.

## Réinitialiser

1. Arrêter l'API.
2. Depuis `backend/` : `.venv/Scripts/python ../tools/recette/reinit.py` (environ 1 min).
3. Relancer l'API sur la base de recette :
   `DATABASE_URL=sqlite:///recette.db ENV=test COOKIE_SECURE=false COOKIE_PATH_PREFIX=/reporting-rh SECRET_KEY=<cle-de-test> .venv/Scripts/python -m uvicorn app.main:app --port 8100`

Mot de passe de tous les comptes : `<mot-de-passe-test>` (ou la variable `RECETTE_PASSWORD`).

## Fichiers

| Fichier | Contenu |
|---|---|
| `comptes.csv` | Un compte par profil. Remplacer les adresses `@exemple.invalid` par les vraies au fur et à mesure. |
| `ca_marge.csv` | CA et marge de janvier 2025 à juin 2026 (marge négative, CA sans marge, mois non saisi, décimales). |
| `budgets.csv` | Budgets de mai (services) et juin 2026 (services, sites, rubriques), au-dessus et en dessous du réel. |

L'historique vient de `Reporting RH/REPORTING_RH_V4.xlsx` (18 mois), enrichi par le script ; la liste des cas s'affiche à la fin.
Juillet à septembre 2026 restent vides : importer `Reporting RH/IMPORT_TEST_JUILLET-SEPTEMBRE_2026.xlsx` en direct.

## Ce que chaque profil doit voir

| Compte | Doit voir | Ne doit pas voir |
|---|---|---|
| admin@, admin2@ | Tout + import, pilotage, comptes | — |
| drh@, dop@ | Tous les services, noms des salariés | Import, pilotage, comptes |
| dps@ | Commerce Pièces, SAV PL, SAV Engins, Sites Déportés | Autres services, noms |
| dir.commercial.vn@ | Commerce VN (EMP015 jusqu'en décembre 2025) | Autres services, noms |
| dc.pneumatique@ | Pneumatique | Autres services, noms |
| dir.technique@ | SAV PL (EMP015 dès janvier 2026) | Autres services, noms |
| resp.sav.engins@ | SAV Engins | Autres services, noms |
| resp.sites.deportes@ | Sites Déportés | Autres services, noms |
