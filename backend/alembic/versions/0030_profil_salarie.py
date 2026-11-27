"""profil du salarié : sexe, date de naissance, date d'embauche

Colonnes facultatives de salarie, lues à l'import (civilité, date de naissance, date d'embauche) pour
les indicateurs de profil (répartition par sexe, âge, ancienneté). Vides tant qu'un import ne les fournit pas.

Revision ID: 0030
Revises: 0029
"""
from alembic import op
import sqlalchemy as sa


revision = '0030'
down_revision = '0029'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("salarie") as b:
        b.add_column(sa.Column("sexe", sa.String(1), nullable=True))
        b.add_column(sa.Column("date_naissance", sa.Date(), nullable=True))
        b.add_column(sa.Column("date_embauche", sa.Date(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("salarie") as b:
        b.drop_column("date_embauche")
        b.drop_column("date_naissance")
        b.drop_column("sexe")
