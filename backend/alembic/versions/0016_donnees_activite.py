"""donnees d'activite : rubriques de nature activite, reference reporting, services productifs, saisie OR/devis/factures

Revision ID: 0016
Revises: 0015
"""
from alembic import op
import sqlalchemy as sa


revision = '0016'
down_revision = '0015'
branch_labels = None
depends_on = None

RUBRIQUES_ACTIVITE = [
    ("Nombre de ventes", "nombre"),
    ("Nombre de clients", "nombre"),
    ("Indice de productivité", "nombre"),
    ("CA individuel", "FCFA"),
    ("Marge individuelle", "FCFA"),
]
SERVICES_PRODUCTIFS = ("SAV PL", "SAV Engins")


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        # CHECK non nommé de 0003 ; SQLite l'omet de lui-même à la recréation de la table.
        op.execute(sa.text("ALTER TABLE rubrique DROP CONSTRAINT IF EXISTS rubrique_unite_check"))
    with op.batch_alter_table("rubrique") as b:
        b.add_column(sa.Column("nature", sa.String(10), nullable=False, server_default="paie"))
        b.create_check_constraint("ck_rubrique_unite", "unite IN ('FCFA','jours','nombre')")
        b.create_check_constraint("ck_rubrique_nature", "nature IN ('paie','activite')")

    # Base vierge : l'amorçage des listes pose les rubriques, à la suite de celles de paie.
    dernier = bind.execute(sa.text("SELECT MAX(ordre) FROM rubrique")).scalar()
    if dernier is not None:
        for i, (lib, unite) in enumerate(RUBRIQUES_ACTIVITE, start=1):
            op.execute(sa.text(
                "INSERT INTO rubrique (libelle, unite, ordre, actif, nature) "
                "SELECT :lib, :unite, :ordre, true, 'activite' "
                "WHERE NOT EXISTS (SELECT 1 FROM rubrique WHERE libelle = :lib)"
            ).bindparams(lib=lib, unite=unite, ordre=dernier + i))

    with op.batch_alter_table("situation_mensuelle") as b:
        b.add_column(sa.Column("reference_activite", sa.String(200), nullable=True))

    with op.batch_alter_table("service") as b:
        b.add_column(sa.Column("productif", sa.Boolean(), nullable=False,
                               server_default=sa.false()))
    for lib in SERVICES_PRODUCTIFS:
        op.execute(sa.text("UPDATE service SET productif = true WHERE libelle = :lib")
                   .bindparams(lib=lib))

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


def downgrade() -> None:
    op.drop_table("activite_saisie")
    with op.batch_alter_table("service") as b:
        b.drop_column("productif")
    with op.batch_alter_table("situation_mensuelle") as b:
        b.drop_column("reference_activite")
    ids = "(SELECT id FROM rubrique WHERE nature = 'activite')"
    op.execute(sa.text(f"DELETE FROM montant WHERE rubrique_id IN {ids}"))
    op.execute(sa.text(f"DELETE FROM rubrique_regle WHERE rubrique_id IN {ids}"))
    op.execute(sa.text(
        f"DELETE FROM ref_alias WHERE dimension = 'rubrique' AND cible_id IN {ids}"))
    op.execute(sa.text("DELETE FROM rubrique WHERE nature = 'activite'"))
    with op.batch_alter_table("rubrique") as b:
        b.drop_constraint("ck_rubrique_nature", type_="check")
        b.drop_constraint("ck_rubrique_unite", type_="check")
        b.drop_column("nature")
        b.create_check_constraint("ck_rubrique_unite", "unite IN ('FCFA','jours')")
