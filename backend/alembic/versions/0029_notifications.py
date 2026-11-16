"""notifications : cloche de l'appli, registre des envois, abonnement e-mail

Tables notification (messages par utilisateur) et notification_envoi (une seule alerte par
utilisateur, mois et canal), colonnes utilisateur.notif_mail et notif_mail_depuis (coupé par défaut).

Revision ID: 0029
Revises: 0028
"""
from alembic import op
import sqlalchemy as sa


revision = '0029'
down_revision = '0028'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notification",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("utilisateur_id", sa.Integer(),
                  sa.ForeignKey("utilisateur.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.String(40), nullable=False),
        sa.Column("titre", sa.String(200), nullable=False),
        sa.Column("texte", sa.String(500), nullable=False),
        sa.Column("lien", sa.String(200), nullable=True),
        sa.Column("lot_id", sa.Integer(),
                  sa.ForeignKey("lot_import.id", ondelete="SET NULL"), nullable=True),
        sa.Column("cree_le", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lue_le", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_notification_utilisateur_id", "notification", ["utilisateur_id"])
    op.create_table(
        "notification_envoi",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("utilisateur_id", sa.Integer(),
                  sa.ForeignKey("utilisateur.id", ondelete="CASCADE"), nullable=False),
        sa.Column("annee", sa.SmallInteger(), nullable=False),
        sa.Column("mois", sa.SmallInteger(), nullable=False),
        sa.Column("canal", sa.String(10), nullable=False),
        sa.Column("envoye_le", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("utilisateur_id", "annee", "mois", "canal"),
    )
    with op.batch_alter_table("utilisateur") as b:
        b.add_column(sa.Column("notif_mail", sa.Boolean(), nullable=False,
                               server_default=sa.false()))
        b.add_column(sa.Column("notif_mail_depuis", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("utilisateur") as b:
        b.drop_column("notif_mail_depuis")
        b.drop_column("notif_mail")
    op.drop_table("notification_envoi")
    op.drop_index("ix_notification_utilisateur_id", table_name="notification")
    op.drop_table("notification")
