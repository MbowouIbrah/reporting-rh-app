#!/bin/sh
# Variables communes. Par défaut les commandes PostgreSQL passent par le conteneur db.
# Surcharge (test local sans Docker) : PG_EXEC="" PGHOST=... PGUSER=... PGPASSWORD=... PG_BIN=/chemin/bin/
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="docker compose -f $RACINE/docker-compose.yml"
PG_EXEC="${PG_EXEC-$COMPOSE exec -T db}"
PG_BIN="${PG_BIN-}"
DB_USER="${POSTGRES_USER:-reporting_rh}"
DB_NAME="${POSTGRES_DB:-reporting_rh}"
BACKUP_DIR="${BACKUP_DIR:-$RACINE/backups}"
RETENTION_JOURS="${RETENTION_JOURS:-30}"
