"""montants gardes tels qu'importes : NUMERIC sans echelle fixe

Revision ID: 0013
Revises: 0012
"""
from alembic import op
import sqlalchemy as sa


revision = '0013'
down_revision = '0012'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("montant") as b:
        b.alter_column("valeur", type_=sa.Numeric(), existing_type=sa.Numeric(18, 3), existing_nullable=False)


def downgrade() -> None:
    with op.batch_alter_table("montant") as b:
        b.alter_column("valeur", type_=sa.Numeric(18, 3), existing_type=sa.Numeric(), existing_nullable=False)
