"""commission exclue du total de ligne (retours de la 2e presentation, Q1)

Revision ID: 0010
Revises: 0009
"""
from alembic import op
import sqlalchemy as sa


revision = '0010'
down_revision = '0009'
branch_labels = None
depends_on = None

RUBRIQUE = "Commission"


def upgrade() -> None:
    # Base vierge : la rubrique n'existe pas encore, l'amorçage des listes pose la règle.
    op.execute(sa.text(
        "INSERT INTO rubrique_regle (rubrique_id, regle, date_debut) "
        "SELECT r.id, 'exclu_total_ligne', '2000-01-01' FROM rubrique r "
        "WHERE r.libelle = :lib AND NOT EXISTS (SELECT 1 FROM rubrique_regle x "
        "WHERE x.rubrique_id = r.id AND x.regle = 'exclu_total_ligne')"
    ).bindparams(lib=RUBRIQUE))


def downgrade() -> None:
    op.execute(sa.text(
        "DELETE FROM rubrique_regle WHERE regle = 'exclu_total_ligne' AND rubrique_id IN "
        "(SELECT id FROM rubrique WHERE libelle = :lib)"
    ).bindparams(lib=RUBRIQUE))
