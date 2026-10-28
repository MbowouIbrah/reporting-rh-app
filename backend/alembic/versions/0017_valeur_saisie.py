"""valeur saisie : CA, marge, OR, devis et factures saisis a un niveau (global, site, service, case)

Revision ID: 0017
Revises: 0016
"""
from alembic import op
import sqlalchemy as sa


revision = '0017'
down_revision = '0016'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "valeur_saisie",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("periode_id", sa.Integer(), nullable=False),
        sa.Column("indicateur", sa.String(10), nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=True),
        sa.Column("service_id", sa.Integer(), nullable=True),
        sa.Column("valeur", sa.Numeric(), nullable=False),
        sa.CheckConstraint("indicateur IN ('ca','marge','or','devis','factures')",
                           name="ck_valeur_saisie_indicateur"),
        sa.ForeignKeyConstraint(["periode_id"], ["periode.id"]),
        sa.ForeignKeyConstraint(["site_id"], ["site.id"]),
        sa.ForeignKeyConstraint(["service_id"], ["service.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_valeur_saisie", "valeur_saisie",
        ["periode_id", "indicateur", sa.text("COALESCE(site_id, 0)"),
         sa.text("COALESCE(service_id, 0)")],
        unique=True)

    op.execute(sa.text(
        "INSERT INTO valeur_saisie (periode_id, indicateur, site_id, service_id, valeur) "
        "SELECT periode_id, 'ca', NULL, NULL, valeur FROM ca_periode"))
    op.execute(sa.text(
        "INSERT INTO valeur_saisie (periode_id, indicateur, site_id, service_id, valeur) "
        "SELECT periode_id, 'marge', NULL, NULL, marge FROM ca_periode WHERE marge IS NOT NULL"))
    op.execute(sa.text(
        "INSERT INTO valeur_saisie (periode_id, indicateur, site_id, service_id, valeur) "
        "SELECT periode_id, indicateur, site_id, service_id, valeur FROM activite_saisie"))
    op.drop_table("activite_saisie")
    op.drop_table("ca_periode")


def downgrade() -> None:
    op.create_table(
        "ca_periode",
        sa.Column("periode_id", sa.Integer(), nullable=False),
        sa.Column("valeur", sa.Numeric(18, 3), nullable=False),
        sa.Column("marge", sa.Numeric(18, 3), nullable=True),
        sa.ForeignKeyConstraint(["periode_id"], ["periode.id"]),
        sa.PrimaryKeyConstraint("periode_id"),
    )
    op.create_table(
        "activite_saisie",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("periode_id", sa.Integer(), nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=False),
        sa.Column("service_id", sa.Integer(), nullable=False),
        sa.Column("indicateur", sa.String(10), nullable=False),
        sa.Column("valeur", sa.Numeric(), nullable=False),
        sa.CheckConstraint("indicateur IN ('or','devis','factures')",
                           name="ck_activite_indicateur"),
        sa.ForeignKeyConstraint(["periode_id"], ["periode.id"]),
        sa.ForeignKeyConstraint(["site_id"], ["site.id"]),
        sa.ForeignKeyConstraint(["service_id"], ["service.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("periode_id", "site_id", "service_id", "indicateur",
                            name="uq_activite_saisie"),
    )
    op.execute(sa.text(
        "INSERT INTO ca_periode (periode_id, valeur, marge) "
        "SELECT c.periode_id, c.valeur, m.valeur FROM valeur_saisie c "
        "LEFT JOIN valeur_saisie m ON m.periode_id = c.periode_id AND m.indicateur = 'marge' "
        "AND m.site_id IS NULL AND m.service_id IS NULL "
        "WHERE c.indicateur = 'ca' AND c.site_id IS NULL AND c.service_id IS NULL"))
    op.execute(sa.text(
        "INSERT INTO activite_saisie (periode_id, site_id, service_id, indicateur, valeur) "
        "SELECT periode_id, site_id, service_id, indicateur, valeur FROM valeur_saisie "
        "WHERE indicateur IN ('or','devis','factures') "
        "AND site_id IS NOT NULL AND service_id IS NOT NULL"))
    op.drop_index("uq_valeur_saisie", table_name="valeur_saisie")
    op.drop_table("valeur_saisie")
