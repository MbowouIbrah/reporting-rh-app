#!/bin/sh
# Restaure une sauvegarde dans une base (par défaut la base de production, après confirmation).
# Usage : deploy/scripts/restauration.sh FICHIER.dump [BASE_CIBLE]
# La base cible est vidée puis recréée. Arrêter l'API avant une restauration de production.
set -eu
. "$(dirname "$0")/_commun.sh"
fichier="${1:?fichier .dump requis}"
cible="${2:-$DB_NAME}"
[ -s "$fichier" ] || { echo "Fichier introuvable ou vide : $fichier" >&2; exit 1; }
if [ "$cible" = "$DB_NAME" ] && [ "${CONFIRMER:-}" != "oui" ]; then
  echo "Restauration sur la base de production '$cible' : relancer avec CONFIRMER=oui" >&2
  exit 2
fi
$PG_EXEC ${PG_BIN}dropdb -U "$DB_USER" --if-exists "$cible"
$PG_EXEC ${PG_BIN}createdb -U "$DB_USER" "$cible"
$PG_EXEC ${PG_BIN}pg_restore -U "$DB_USER" -d "$cible" --no-owner --exit-on-error < "$fichier"
echo "Restauré dans $cible"
