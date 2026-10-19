# Reporting RH (application)

- Stack : FastAPI + SQLAlchemy 2 + Alembic + PostgreSQL 16 / React 19 + TS + Vite. Design : tokens cfaoacademy (`frontend/src/styles/tokens.css`).
- Plan par phases : `docs/PLAN_APPLICATION.md`. KPI et rôles : `docs/P0_CADRAGE.md`. Hors périmètre du cycle en cours : `backlog.md`.
- Montants importés en `NUMERIC` sans échelle fixe (décimales gardées telles quelles, jamais d'arrondi), jamais float. Calculs KPI côté serveur. Filtre de périmètre appliqué dans la couche dépôt, jamais côté front.
- Backend : `cd backend && .venv/Scripts/python -m pytest -q` et `-m ruff check .`. Frontend : `npm run build && npm test`.
- Commits : `NN-x: description`, sans mention d'outil d'assistance.
