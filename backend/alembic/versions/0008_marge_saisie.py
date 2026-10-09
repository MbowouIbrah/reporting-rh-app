"""marge saisie : la marge du mois est saisie avec le CA, plus calculee CA - MS

Revision ID: 0008
Revises: 0007
"""
from alembic import op
import sqlalchemy as sa


revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("ca_periode") as b:
        b.add_column(sa.Column("marge", sa.Numeric(18, 3), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("ca_periode") as b:
        b.drop_column("marge")
