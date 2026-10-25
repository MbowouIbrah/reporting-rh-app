"""type de contrat Stage (3e presentation, demande 5)

Revision ID: 0015
Revises: 0014
"""
from alembic import op
import sqlalchemy as sa


revision = '0015'
down_revision = '0014'
branch_labels = None
depends_on = None

LIBELLE = "Stage"


def upgrade() -> None:
    op.execute(sa.text(
        "INSERT INTO type_contrat (libelle, actif) SELECT :lib, true "
        "WHERE NOT EXISTS (SELECT 1 FROM type_contrat WHERE libelle = :lib)"
    ).bindparams(lib=LIBELLE))


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM type_contrat WHERE libelle = :lib").bindparams(lib=LIBELLE))
