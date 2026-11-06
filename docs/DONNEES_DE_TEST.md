# Données de test : les générer chez soi

Le dépôt ne contient aucune adresse e-mail ni aucun mot de passe. Chacun génère ses comptes et ses données de test en local. Les fichiers produits ne sont pas suivis par git.

## 1. Tests automatiques (pytest, vitest)
Rien à préparer. Les adresses sont fabriquées par `courriel(nom)` (domaine `exemple.invalid`, qui ne peut pas exister). Les mots de passe et la clé secrète sont tirés au hasard à chaque lancement.

```
cd backend && .venv/Scripts/python -m pytest -q
cd frontend && npm test
```

## 2. Parcours navigateur (base e2e, 100 % fictive)
`E2E_PASSWORD` et `SECRET_KEY` sont générés au lancement si on ne les fournit pas.

```
cd frontend && npx playwright test
```

## 3. Recette (base 100 % fictive)
L'historique de paie est généré par `tools/recette/donnees_fictives.py` (janvier 2024 au dernier mois clos, mêmes données à chaque passage). Aucun fichier réel n'est nécessaire.

1. Générer les comptes locaux à partir des profils de `tools/recette/comptes.exemple.csv` :
   ```
   backend/.venv/Scripts/python tools/recette/generer_comptes.py
   ```
   Cela crée `tools/recette/comptes.local.csv` (adresse et mot de passe de chaque profil). Variables facultatives :
   - `RECETTE_DOMAINE` : domaine des adresses (par défaut `exemple.invalid`) ;
   - `RECETTE_SUFFIXE` : règle simple à retenir, mot de passe = identifiant + suffixe (exemple de forme : `admin` + votre suffixe). Choisissez votre suffixe, ne l'écrivez jamais dans un fichier suivi. Sans suffixe : mot de passe aléatoire.
2. Lancer la recette : la configuration Playwright génère les comptes s'ils manquent.
   ```
   cd frontend && E2E_BASE=recette-e2e.db npx playwright test -c playwright.recette.config.ts
   ```

Les mots de passe sont lisibles dans `comptes.local.csv`, sur votre poste seulement.

## 4. Démo (`seed --demo`)
Définir dans `backend/.env` (non suivi) :
- `ADMIN_EMAIL` et `ADMIN_PASSWORD` : le compte administrateur ;
- `DEMO_DOMAINE` : domaine des comptes de démo ;
- `DEMO_PASSWORD` : leur mot de passe.

```
cd backend && .venv/Scripts/python -m app.seed --demo
```

Les comptes de démo reçoivent un mot de passe provisoire à changer à la première connexion.

## Règles
- Jamais d'adresse ni de mot de passe écrit dans un fichier suivi, même pour un test : passer par `courriel()` ou une variable d'environnement.
- Fichiers locaux ignorés : `.env`, `tools/recette/comptes.local.csv`, bases `*.db`, `PASSATION.md`.
