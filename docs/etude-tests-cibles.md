# Étude : tests ciblés

## Besoin
Les suites sont longues : backend 3 min 30 (502 tests), recette Playwright 7 à 9 min. Relancer tout après une retouche d'un seul module coûte trop. Principe demandé : un module se teste seul, puis avec les modules qui l'utilisent ; on ne relance que ce qui est concerné.

## Existant
- Backend : chaque test recrée une base SQLite en mémoire (`tests/conftest.py`), les tests d'API passent par `TestClient`. Les imports ne disent donc pas quel test touche quel module (un test d'API n'importe pas le routeur).
- Frontend : Vitest, tests à côté des composants. `vitest related` suit déjà les imports.
- Recette : `playwright.recette.config.ts`, base réinitialisée à chaque lancement, specs par écran.
- `coverage` est déjà dans le venv (pas de dépendance ajoutée : le venv est partagé avec la version de test).

## Options
| Option | Pour | Contre |
|---|---|---|
| A. Graphe d'imports | Simple | Faux pour les tests d'API (passent par HTTP) |
| B. Carte par couverture (fichier de app/ → fichiers de test qui l'exécutent) | Exact, suit les appels réels, threads compris | Carte à refaire de temps en temps |
| C. pytest-testmon | Prêt à l'emploi | Nouvelle dépendance dans un venv partagé |

**Choix : B** pour le backend, `vitest related` pour le frontend, table écran → specs pour la recette.

## Fonctionnement
- `CARTE_TESTS=1 pytest` écrit `backend/.carte-tests.json` (hors dépôt). Le script la refait à chaque suite complète.
- `tools/tests_cibles.py` lit les fichiers modifiés (non commités, ou `--depuis main`), puis lance : ruff sur les fichiers Python modifiés, pytest sur les seuls tests liés, `npm run build` (types vérifiés partout) et `vitest related`.
- **Socle** : modèles, base, configuration, `main.py`, seed, conftest, dépendances. Les changer relance tout, car la couverture ne voit pas les lignes exécutées à l'import.
- Fichier de app/ inconnu de la carte (nouveau, ou lu seulement à l'import) : suite complète, puis carte refaite.
- Recette : `--recette` lance seulement les specs de la table. Un composant partagé (`components/`, `lib/`, `api/`, styles) relance toute la recette.

## Quand tout relancer
- Fin d'étape, avant le commit qui part sur la version de test : suite complète + recette.
- Pendant le travail : tests ciblés seulement.

## Risques
- Carte périmée : un test nouveau qui touche un module ancien n'est pas relancé tant que la carte n'est pas refaite. Le script le signale. Parade : la suite complète de fin d'étape.
- Specs de recette lancées seules : elles partent d'une base réinitialisée, mais l'ordre entre fichiers est gardé (ordre alphabétique).
