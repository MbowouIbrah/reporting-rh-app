"""budget

Revision ID: 0005
Revises: 0004
"""
from alembic import op
import sqlalchemy as sa


revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('budget',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('periode_id', sa.Integer(), nullable=False),
    sa.Column('axe', sa.String(length=10), nullable=False),
    sa.Column('cible_id', sa.Integer(), nullable=False),
    sa.Column('valeur', sa.Numeric(precision=18, scale=3), nullable=False),
    sa.CheckConstraint("axe IN ('rubrique','service','site')", name='ck_budget_axe'),
    sa.ForeignKeyConstraint(['periode_id'], ['periode.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('periode_id', 'axe', 'cible_id', name='uq_budget')
    )


def downgrade() -> None:
    op.drop_table('budget')
