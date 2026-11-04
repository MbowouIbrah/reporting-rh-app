"""preference utilisateur : reglages d'affichage gardes sur le serveur (graphiques masques)

Revision ID: 0019
Revises: 0018
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = '0019'
down_revision = '0018'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "preference_utilisateur",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("utilisateur_id", sa.Integer(),
                  sa.ForeignKey("utilisateur.id", ondelete="CASCADE"), nullable=False),
        sa.Column("cle", sa.String(60), nullable=False),
        sa.Column("valeur", sa.JSON().with_variant(JSONB(), "postgresql"), nullable=False),
        sa.UniqueConstraint("utilisateur_id", "cle", name="uq_preference_utilisateur"),
    )


def downgrade() -> None:
    op.drop_table("preference_utilisateur")
