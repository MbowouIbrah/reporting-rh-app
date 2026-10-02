"""auth, périmètres, audit

Revision ID: 0002
Revises: 0001
"""
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

JsonType = sa.JSON().with_variant(JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "perimetre",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("code", sa.String(50), nullable=False, unique=True),
        sa.Column("libelle", sa.String(200), nullable=False),
    )
    op.create_table(
        "perimetre_regle",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "perimetre_id", sa.Integer, sa.ForeignKey("perimetre.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("dimension", sa.String(20), nullable=False),
        sa.Column("valeur", sa.String(200), nullable=False),
        sa.UniqueConstraint("perimetre_id", "dimension", "valeur"),
    )
    op.create_table(
        "utilisateur",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("nom", sa.String(200), nullable=False),
        sa.Column("password_hash", sa.String(100), nullable=False),
        sa.Column("actif", sa.Boolean, nullable=False),
        sa.Column("cree_le", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "role_assignment",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "utilisateur_id", sa.Integer, sa.ForeignKey("utilisateur.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(30), nullable=False),
        sa.Column("perimetre_id", sa.Integer, sa.ForeignKey("perimetre.id"), nullable=True),
        sa.Column("nominatif", sa.Boolean, nullable=False),
    )
    op.create_table(
        "audit_event",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("utilisateur_id", sa.Integer, nullable=True),
        sa.Column("action", sa.String(50), nullable=False),
        sa.Column("entite", sa.String(50), nullable=False),
        sa.Column("entite_id", sa.String(50), nullable=True),
        sa.Column("avant", JsonType, nullable=True),
        sa.Column("apres", JsonType, nullable=True),
    )


def downgrade() -> None:
    for t in ("audit_event", "role_assignment", "utilisateur", "perimetre_regle", "perimetre"):
        op.drop_table(t)
