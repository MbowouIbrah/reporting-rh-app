"""import automatique : origine et chemin du lot, frais de mission dans la correspondance de paie

lot_import.origine ('manuel' | 'dossier') et lot_import.chemin (nom du fichier dans le dossier de paie) ;
« Frais de mission » reçoit les colonnes DEPALCEMENT PRO et RAPPEL DEPLAC. PRO de l'export de paie
(orthographe exacte) si elles ne sont pas déjà reliées et si la rubrique existe.

Revision ID: 0027
Revises: 0026
"""
import re
import unicodedata

from alembic import op
import sqlalchemy as sa


revision = '0027'
down_revision = '0026'
branch_labels = None
depends_on = None

RUBRIQUE = "Frais de mission"
COLONNES = ["DEPALCEMENT PRO", "RAPPEL DEPLAC. PRO"]


def _norm(v: str) -> str:
    s = unicodedata.normalize("NFKD", str(v).replace(chr(160), " ").strip())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).casefold()


def upgrade() -> None:
    with op.batch_alter_table("lot_import") as b:
        b.add_column(sa.Column("origine", sa.String(10), nullable=False, server_default="manuel"))
        b.add_column(sa.Column("chemin", sa.String(500), nullable=True))
    conn = op.get_bind()
    rid = conn.execute(sa.text("SELECT id FROM rubrique WHERE libelle = :l"), {"l": RUBRIQUE}).scalar()
    if rid is None:
        return
    for colonne in COLONNES:
        existe = conn.execute(sa.text("SELECT 1 FROM correspondance_paie WHERE colonne_norm = :n"),
                              {"n": _norm(colonne)}).scalar()
        if not existe:
            conn.execute(sa.text(
                "INSERT INTO correspondance_paie (colonne, colonne_norm, rubrique_id) "
                "VALUES (:c, :n, :r)"), {"c": colonne, "n": _norm(colonne), "r": rid})


def downgrade() -> None:
    conn = op.get_bind()
    rid = conn.execute(sa.text("SELECT id FROM rubrique WHERE libelle = :l"), {"l": RUBRIQUE}).scalar()
    if rid is not None:
        for colonne in COLONNES:
            conn.execute(sa.text("DELETE FROM correspondance_paie WHERE colonne_norm = :n AND rubrique_id = :r"),
                         {"n": _norm(colonne), "r": rid})
    with op.batch_alter_table("lot_import") as b:
        b.drop_column("chemin")
        b.drop_column("origine")
