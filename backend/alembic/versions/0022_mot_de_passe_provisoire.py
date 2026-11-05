"""mot de passe provisoire : changement obligatoire a la connexion

Revision ID: 0022
Revises: 0021
"""
from alembic import op
import sqlalchemy as sa


revision = '0022'
down_revision = '0021'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Comptes existants : leur mot de passe reste valable, aucun changement impose.
    op.add_column("utilisateur", sa.Column("doit_changer_mdp", sa.Boolean(), nullable=False,
                                           server_default=sa.false()))


def downgrade() -> None:
    with op.batch_alter_table("utilisateur") as b:
        b.drop_column("doit_changer_mdp")
