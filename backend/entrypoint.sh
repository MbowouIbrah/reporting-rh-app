#!/bin/sh
set -e
alembic upgrade head
# listes de valeurs et administrateur (idempotent) ; ignore si ADMIN_EMAIL/ADMIN_PASSWORD absents
if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then python -m app.seed; fi
exec "$@"
