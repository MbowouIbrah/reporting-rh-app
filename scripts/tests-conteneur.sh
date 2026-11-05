#!/bin/sh
# Lancé dans l'image de test. Usage : tests-conteneur.sh [pg|back|front|e2e|audit|tout]
set -e
PY=/repo/backend/.venv/bin/python

pg() {
  echo "== Migrations et import sur PostgreSQL"
  cd /repo/backend
  export DATABASE_URL="$TEST_DATABASE_URL" ENV=test SECRET_KEY=<cle-de-test>
  $PY -m alembic upgrade head
  $PY -m alembic downgrade 0020
  $PY -m alembic upgrade head
  $PY -m alembic downgrade base
  $PY -m pytest -q tests/test_import_pg.py
  unset DATABASE_URL ENV SECRET_KEY
}
back() {
  echo "== Backend"
  cd /repo/backend
  $PY -m ruff check .
  $PY -m pytest -q
  cd /repo
  $PY -m pytest -q tools/test_valider_import.py
}
front() {
  echo "== Frontend"
  cd /repo/frontend
  npm run build
  npm test
}
e2e() {
  echo "== Parcours navigateur"
  cd /repo/frontend
  npx playwright test --reporter=line
  npx playwright test -c playwright.recette.config.ts --reporter=line
}
audit() {
  echo "== Failles connues des dépendances"
  cd /repo/backend
  .venv/bin/pip-audit -r requirements.txt
  cd /repo/frontend
  npm audit --audit-level=high
}

case "${1:-tout}" in
  pg) pg ;;
  back) back ;;
  front) front ;;
  e2e) e2e ;;
  audit) audit ;;
  tout) pg; back; front; e2e ;;
  *) echo "Usage : $0 [pg|back|front|e2e|audit|tout]"; exit 2 ;;
esac
echo "== OK : ${1:-tout}"
