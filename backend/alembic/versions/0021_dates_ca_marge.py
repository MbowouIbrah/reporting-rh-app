"""dates du CA et de la marge : saisie la plus recente entre la case et la somme des employes

Revision ID: 0021
Revises: 0020
"""
from alembic import op
import sqlalchemy as sa


revision = '0021'
down_revision = '0020'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Aucune date cote employes a la migration : les saisies existantes restent les plus recentes.
    op.add_column("valeur_saisie", sa.Column("modifie_le", sa.DateTime(timezone=True), nullable=True))
    op.add_column("valeur_saisie", sa.Column("tranche_le", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE valeur_saisie SET modifie_le = CURRENT_TIMESTAMP")
    if op.get_bind().dialect.name == "sqlite":
        # SQLite recree la table : l'index sur expressions ne survivrait pas a la copie.
        op.drop_index("uq_valeur_saisie", table_name="valeur_saisie")
        with op.batch_alter_table("valeur_saisie") as b:
            b.alter_column("modifie_le", existing_type=sa.DateTime(timezone=True), nullable=False)
        op.create_index("uq_valeur_saisie", "valeur_saisie",
                        ["periode_id", "indicateur", sa.text("COALESCE(site_id, 0)"),
                         sa.text("COALESCE(service_id, 0)")], unique=True)
    else:
        op.alter_column("valeur_saisie", "modifie_le", nullable=False)
    op.create_table(
        "date_employes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("periode_id", sa.Integer(), sa.ForeignKey("periode.id"), nullable=False),
        sa.Column("indicateur", sa.String(20), nullable=False),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("site.id"), nullable=True),
        sa.Column("service_id", sa.Integer(), sa.ForeignKey("service.id"), nullable=True),
        sa.Column("modifie_le", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("uq_date_employes", "date_employes",
                    ["periode_id", "indicateur", sa.text("COALESCE(site_id, 0)"),
                     sa.text("COALESCE(service_id, 0)")], unique=True)


def downgrade() -> None:
    op.drop_table("date_employes")
    op.drop_column("valeur_saisie", "tranche_le")
    op.drop_column("valeur_saisie", "modifie_le")
