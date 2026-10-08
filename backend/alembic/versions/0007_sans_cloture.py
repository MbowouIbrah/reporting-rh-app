"""sans cloture : un mois reste modifiable, le journal d'audit trace chaque ecriture

Revision ID: 0007
Revises: 0006
"""
from alembic import op
import sqlalchemy as sa


revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None

# SQLite recrée la table en batch et omet les CHECK non nommés : on garde celui du mois.
MOIS = (sa.CheckConstraint("mois BETWEEN 1 AND 12"),)


def upgrade() -> None:
    # La contrainte CHECK sur statut disparait avec la colonne (PostgreSQL comme SQLite en batch).
    with op.batch_alter_table("periode", table_args=MOIS) as b:
        b.drop_column("close_par")
        b.drop_column("close_le")
        b.drop_column("statut")


def downgrade() -> None:
    with op.batch_alter_table("periode", table_args=MOIS) as b:
        b.add_column(sa.Column("statut", sa.String(length=10), nullable=False,
                               server_default="ouverte"))
        b.add_column(sa.Column("close_le", sa.DateTime(timezone=True), nullable=True))
        b.add_column(sa.Column("close_par", sa.Integer(), nullable=True))
        b.create_check_constraint("ck_periode_statut", "statut IN ('ouverte','close')")
