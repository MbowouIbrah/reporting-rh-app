#!/bin/sh
# Variables communes. Par défaut les commandes PostgreSQL passent par le conteneur db.
# Surcharge (test local sans Docker) : PG_EXEC="" PGHOST=... PGUSER=... PGPASSWORD=... PG_BIN=/chemin/bin/
DEPLOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="docker compose -f $DEPLOY_DIR/docker-compose.yml"
PG_EXEC="${PG_EXEC-$COMPOSE exec -T db}"
PG_BIN="${PG_BIN-}"
DB_USER="${POSTGRES_USER:-reporting_rh}"
DB_NAME="${POSTGRES_DB:-reporting_rh}"
BACKUP_DIR="${BACKUP_DIR:-$DEPLOY_DIR/backups}"
RETENTION_JOURS="${RETENTION_JOURS:-30}"
