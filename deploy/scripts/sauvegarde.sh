#!/bin/sh
# Sauvegarde logique (pg_dump format custom) horodatée, avec rotation.
# Usage : deploy/scripts/sauvegarde.sh   (cron conseillé : 0 2 * * *)
set -eu
. "$(dirname "$0")/_commun.sh"
mkdir -p "$BACKUP_DIR"
fichier="$BACKUP_DIR/reporting_rh_$(date +%Y%m%d_%H%M%S).dump"
$PG_EXEC ${PG_BIN}pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$fichier.tmp"
[ -s "$fichier.tmp" ] || { echo "Sauvegarde vide" >&2; rm -f "$fichier.tmp"; exit 1; }
mv "$fichier.tmp" "$fichier"
find "$BACKUP_DIR" -name 'reporting_rh_*.dump' -mtime +"$RETENTION_JOURS" -delete
echo "$fichier"
