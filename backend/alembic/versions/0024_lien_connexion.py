"""liens de connexion directe (demo, invitation)

Revision ID: 0024
Revises: 0023
"""
from alembic import op
import sqlalchemy as sa


revision = '0024'
down_revision = '0023'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'lien_connexion',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('utilisateur_id', sa.Integer(),
                  sa.ForeignKey('utilisateur.id', ondelete='CASCADE'), nullable=False),
        sa.Column('empreinte', sa.String(64), nullable=False, unique=True),
        sa.Column('cree_le', sa.DateTime(timezone=True), nullable=False),
        sa.Column('expire_le', sa.DateTime(timezone=True), nullable=False),
        sa.Column('revoque_le', sa.DateTime(timezone=True), nullable=True),
        sa.Column('derniere_utilisation', sa.DateTime(timezone=True), nullable=True),
        sa.Column('nb_utilisations', sa.Integer(), nullable=False, server_default='0'),
    )
    op.create_index('ix_lien_connexion_utilisateur_id', 'lien_connexion', ['utilisateur_id'])


def downgrade() -> None:
    op.drop_index('ix_lien_connexion_utilisateur_id', table_name='lien_connexion')
    op.drop_table('lien_connexion')
