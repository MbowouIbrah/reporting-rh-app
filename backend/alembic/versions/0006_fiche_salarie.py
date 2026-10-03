"""fiche salarie

Revision ID: 0006
Revises: 0005
"""
from alembic import op
import sqlalchemy as sa


revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None

DIMS = [("poste_id", "poste"), ("service_id", "service"), ("site_id", "site"),
        ("activite_id", "activite"), ("type_contrat_id", "type_contrat")]


def upgrade() -> None:
    with op.batch_alter_table("salarie") as b:
        for col, table in DIMS:
            b.add_column(sa.Column(col, sa.Integer(), sa.ForeignKey(f"{table}.id", name=f"fk_salarie_{col}"), nullable=True))
        b.add_column(sa.Column("actif", sa.Boolean(), nullable=False, server_default=sa.true()))
    # Fiche initiale = situation la plus récente (année, mois) de chaque salarié.
    op.execute("""
        UPDATE salarie SET
          poste_id = (SELECT s.poste_id FROM situation_mensuelle s JOIN periode p ON p.id = s.periode_id
                      WHERE s.salarie_id = salarie.id ORDER BY p.annee DESC, p.mois DESC LIMIT 1),
          service_id = (SELECT s.service_id FROM situation_mensuelle s JOIN periode p ON p.id = s.periode_id
                      WHERE s.salarie_id = salarie.id ORDER BY p.annee DESC, p.mois DESC LIMIT 1),
          site_id = (SELECT s.site_id FROM situation_mensuelle s JOIN periode p ON p.id = s.periode_id
                      WHERE s.salarie_id = salarie.id ORDER BY p.annee DESC, p.mois DESC LIMIT 1),
          activite_id = (SELECT s.activite_id FROM situation_mensuelle s JOIN periode p ON p.id = s.periode_id
                      WHERE s.salarie_id = salarie.id ORDER BY p.annee DESC, p.mois DESC LIMIT 1),
          type_contrat_id = (SELECT s.type_contrat_id FROM situation_mensuelle s JOIN periode p ON p.id = s.periode_id
                      WHERE s.salarie_id = salarie.id ORDER BY p.annee DESC, p.mois DESC LIMIT 1)
    """)


def downgrade() -> None:
    with op.batch_alter_table("salarie") as b:
        b.drop_column("actif")
        for col, _ in DIMS:
            b.drop_column(col)
