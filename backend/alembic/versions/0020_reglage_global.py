"""reglage global : reglages communs a tous les utilisateurs (noms des groupes de graphiques)

Revision ID: 0020
Revises: 0019
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = '0020'
down_revision = '0019'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reglage_global",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cle", sa.String(60), nullable=False, unique=True),
        sa.Column("valeur", sa.JSON().with_variant(JSONB(), "postgresql"), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("reglage_global")
