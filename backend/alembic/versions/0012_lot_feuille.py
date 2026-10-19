"""feuille lue gardee dans le lot (corrections sur place a la verification)

Revision ID: 0012
Revises: 0011
"""
from alembic import op
import sqlalchemy as sa


revision = '0012'
down_revision = '0011'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("lot_import", sa.Column("feuille", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("lot_import", "feuille")
