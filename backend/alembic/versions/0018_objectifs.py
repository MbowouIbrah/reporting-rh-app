"""objectifs : valeur_saisie accepte les indicateurs obj_* (CA, marge, ventes, clients, factures,
productivite), colonne indicateur elargie a 20 caracteres

Revision ID: 0018
Revises: 0017
"""
from alembic import op
import sqlalchemy as sa


revision = '0018'
down_revision = '0017'
branch_labels = None
depends_on = None

ANCIEN = "indicateur IN ('ca','marge','or','devis','factures')"
NOUVEAU = ("indicateur IN ('ca','marge','or','devis','factures','obj_ca','obj_marge',"
           "'obj_ventes','obj_clients','obj_factures','obj_productivite')")


def _refaire(longueur: int, condition: str) -> None:
    # L'index d'unicite porte des expressions (COALESCE) que SQLite ne sait pas recreer en
    # batch : on le retire avant et on le remet apres.
    op.drop_index("uq_valeur_saisie", table_name="valeur_saisie")
    with op.batch_alter_table("valeur_saisie") as b:
        b.drop_constraint("ck_valeur_saisie_indicateur", type_="check")
        b.alter_column("indicateur", existing_type=sa.String(), type_=sa.String(longueur),
                       existing_nullable=False)
        b.create_check_constraint("ck_valeur_saisie_indicateur", condition)
    op.create_index(
        "uq_valeur_saisie", "valeur_saisie",
        ["periode_id", "indicateur", sa.text("COALESCE(site_id, 0)"),
         sa.text("COALESCE(service_id, 0)")],
        unique=True)


def upgrade() -> None:
    _refaire(20, NOUVEAU)


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM valeur_saisie WHERE indicateur NOT IN "
                       "('ca','marge','or','devis','factures')"))
    _refaire(10, ANCIEN)
