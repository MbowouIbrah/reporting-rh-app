#!/bin/sh
# Prouve qu'une sauvegarde est restaurable : restaure dans une base jetable et compare
# le nombre de lignes de chaque table avec la base source. Code retour 0 = identique.
# Usage : scripts/test-restauration.sh [FICHIER.dump]  (défaut : dernière sauvegarde)
set -eu
. "$(dirname "$0")/_commun.sh"
fichier="${1:-$(ls -t "$BACKUP_DIR"/reporting_rh_*.dump | head -n 1)}"
tmp="${DB_NAME}_restore_test"
comptes() {  # comptage exact, pas les statistiques
  $PG_EXEC ${PG_BIN}psql -U "$DB_USER" -d "$1" -At -c \
    "SELECT string_agg(format('SELECT %L || ''='' || count(*) FROM %I', tablename, tablename), ' UNION ALL ' ORDER BY tablename) FROM pg_tables WHERE schemaname='public'" \
    | { read -r q; $PG_EXEC ${PG_BIN}psql -U "$DB_USER" -d "$1" -At -c "$q" | sort; }
}
"$(dirname "$0")/restauration.sh" "$fichier" "$tmp" >/dev/null
trap '$PG_EXEC ${PG_BIN}dropdb -U "$DB_USER" --if-exists "$tmp"' EXIT
comptes "$DB_NAME" > "$BACKUP_DIR/.src.txt"
comptes "$tmp" > "$BACKUP_DIR/.rest.txt"
if diff "$BACKUP_DIR/.src.txt" "$BACKUP_DIR/.rest.txt" >/dev/null; then
  echo "OK : $(wc -l < "$BACKUP_DIR/.rest.txt") tables identiques ($fichier)"
  rm -f "$BACKUP_DIR/.src.txt" "$BACKUP_DIR/.rest.txt"
else
  echo "ÉCART entre source et restauration :" >&2
  diff "$BACKUP_DIR/.src.txt" "$BACKUP_DIR/.rest.txt" >&2 || true
  exit 1
fi
