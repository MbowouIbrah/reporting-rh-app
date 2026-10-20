# Reporting RH

Application web de reporting RH (remplace le classeur Excel REPORTING_RH_V5).
Backend FastAPI + PostgreSQL, frontend React + TypeScript, habillage cfaoacademy.

- Plan : [docs/PLAN_APPLICATION.md](docs/PLAN_APPLICATION.md) · Cadrage (KPI, rôles) : [docs/P0_CADRAGE.md](docs/P0_CADRAGE.md) · Backlog : [backlog.md](backlog.md) · Étude page Utilisateurs : [docs/etude-page-utilisateurs.md](docs/etude-page-utilisateurs.md)
- Template d'import : `templates/TEMPLATE_IMPORT_DONNEES_v1.xlsx` · Contrôle : `python tools/valider_import.py FICHIER.xlsx`

## Développement
```
cd backend && python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt
.venv/Scripts/python -m pytest -q          # tests (SQLite en mémoire)
.venv/Scripts/uvicorn app.main:app --reload # API sur :8000 (Postgres via .env)

cd frontend && npm install && npm run dev   # http://localhost:5173/reporting-rh/
```

## Déploiement (même serveur qu'Academy)
1. `docker network create edge` (une fois) et rattacher le nginx d'Academy à ce réseau.
2. `cp deploy/.env.example deploy/.env`, renseigner les secrets.
3. `docker compose -f deploy/docker-compose.yml up -d --build`
4. Inclure `deploy/nginx-academy-snippet.conf` dans le nginx d'Academy, puis recharger.

La base n'expose aucun port. L'API applique les migrations Alembic au démarrage.
Exploitation, sauvegardes, restauration, rollback : [docs/RUNBOOK.md](docs/RUNBOOK.md).
