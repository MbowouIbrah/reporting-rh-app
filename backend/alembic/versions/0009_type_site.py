"""type de site : principal, agence ou deporte (principal par defaut)

Revision ID: 0009
Revises: 0008
"""
from alembic import op
import sqlalchemy as sa


revision = '0009'
down_revision = '0008'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("site") as b:
        b.add_column(sa.Column("type_site", sa.String(20), nullable=False,
                               server_default="principal"))
        b.create_check_constraint("ck_site_type_site",
                                  "type_site IN ('principal','agence','deporte')")


def downgrade() -> None:
    with op.batch_alter_table("site") as b:
        b.drop_constraint("ck_site_type_site", type_="check")
        b.drop_column("type_site")
