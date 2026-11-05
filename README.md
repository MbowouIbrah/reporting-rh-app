# Reporting RH

Application web de reporting RH (remplace le classeur Excel REPORTING_RH_V5).
Backend FastAPI + PostgreSQL, frontend React + TypeScript, habillage cfaoacademy.

- Plan : [docs/PLAN_APPLICATION.md](docs/PLAN_APPLICATION.md) · Cadrage (KPI, rôles) : [docs/P0_CADRAGE.md](docs/P0_CADRAGE.md) · Backlog : [backlog.md](backlog.md) · Étude page Utilisateurs : [docs/etude-page-utilisateurs.md](docs/etude-page-utilisateurs.md) · Étude droits : [docs/etude-droits.md](docs/etude-droits.md) · Étude navigation admin : [docs/etude-navigation-admin.md](docs/etude-navigation-admin.md) · Étude connexion : [docs/etude-connexion.md](docs/etude-connexion.md) · Étude 3e présentation (lot 1) : [docs/etude-presentation-3-lot1.md](docs/etude-presentation-3-lot1.md) · Étude graphiques par groupes : [docs/etude-graphes-groupes.md](docs/etude-graphes-groupes.md)
- Études : [changement de mot de passe obligatoire](docs/etude-changement-mot-de-passe.md) · [perte de connexion](docs/etude-reseau.md) · [gestion des colonnes](docs/etude-gestion-colonnes.md) · [tests ciblés](docs/etude-tests-cibles.md).
- Template d'import : `templates/TEMPLATE_IMPORT_DONNEES_v1.xlsx` · Contrôle : `python tools/valider_import.py FICHIER.xlsx`

## Développement
```
cd backend && python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt
.venv/Scripts/python -m pytest -q          # tests (SQLite en mémoire)
.venv/Scripts/uvicorn app.main:app --reload # API sur :8000 (Postgres via .env)

cd frontend && npm install && npm run dev   # http://localhost:5173/
```

## Déploiement
Projet autonome : `backend/`, `frontend/`, base PostgreSQL, tout dans `docker-compose.yml`.
1. `cp .env.example .env`, renseigner les secrets.
2. `make up` (ou `docker compose up -d --build`) : application sur http://localhost:8080.
3. En production, placer un proxy HTTPS devant le port 8080 (voir le runbook).

Tests en conteneur, avec limites de mémoire et de processeur : `make test`, puis `make test-clean`.

La base n'expose aucun port. L'API applique les migrations Alembic au démarrage.
Exploitation, sauvegardes, restauration, rollback : [docs/RUNBOOK.md](docs/RUNBOOK.md).
