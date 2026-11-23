"""departements (BU) : liste de valeurs Equipment et Winpart, rattachement des services

Table departement (liste de valeurs) et service.departement_id (facultatif). Winpart, Motul et
Autofast (comparaison sans accents ni casse) rejoignent le departement Winpart, tous les autres
services Equipment. 'departement' devient une dimension d'alias d'import.

Revision ID: 0028
Revises: 0027
"""
import re
import unicodedata

from alembic import op
import sqlalchemy as sa


revision = '0028'
down_revision = '0027'
branch_labels = None
depends_on = None

DEPARTEMENTS = ["Equipment", "Winpart"]
SERVICES_WINPART = {"winpart", "motul", "autofast"}
AVANT = "'service','activite','site','type_contrat','poste','rubrique','mois'"
APRES = AVANT + ",'departement'"


def _norm(v: str) -> str:
    s = unicodedata.normalize("NFKD", str(v).replace(chr(160), " ").strip())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).casefold()


def _contrainte_alias(valeurs: str) -> None:
    """Remplace la contrainte de ref_alias.dimension (Postgres : par son nom ; SQLite : copie de table)."""
    condition = f"dimension IN ({valeurs})"
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("ref_alias") as b:
            b.create_check_constraint("ck_ref_alias_dimension", condition)
        return
    op.execute("ALTER TABLE ref_alias DROP CONSTRAINT IF EXISTS ref_alias_dimension_check")
    op.execute("ALTER TABLE ref_alias DROP CONSTRAINT IF EXISTS ck_ref_alias_dimension")
    op.create_check_constraint("ck_ref_alias_dimension", "ref_alias", condition)


def upgrade() -> None:
    op.create_table(
        "departement",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("libelle", sa.String(200), nullable=False, unique=True),
        sa.Column("actif", sa.Boolean(), nullable=False),
    )
    with op.batch_alter_table("service") as b:
        b.add_column(sa.Column("departement_id", sa.Integer(),
                               sa.ForeignKey("departement.id", name="fk_service_departement"),
                               nullable=True))
    _contrainte_alias(APRES)
    conn = op.get_bind()
    ids = {}
    for libelle in DEPARTEMENTS:
        conn.execute(sa.text("INSERT INTO departement (libelle, actif) VALUES (:l, :a)"),
                     {"l": libelle, "a": True})
        ids[libelle] = conn.execute(sa.text("SELECT id FROM departement WHERE libelle = :l"),
                                    {"l": libelle}).scalar()
    for sid, libelle in conn.execute(sa.text("SELECT id, libelle FROM service")).all():
        cible = ids["Winpart" if _norm(libelle) in SERVICES_WINPART else "Equipment"]
        conn.execute(sa.text("UPDATE service SET departement_id = :d WHERE id = :s"),
                     {"d": cible, "s": sid})


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("DELETE FROM ref_alias WHERE dimension = 'departement'"))
    conn.execute(sa.text("DELETE FROM utilisateur_portee WHERE type = 'departement'"))
    with op.batch_alter_table("service") as b:
        b.drop_constraint("fk_service_departement", type_="foreignkey")
        b.drop_column("departement_id")
    op.drop_table("departement")
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("ref_alias") as b:
            b.drop_constraint("ck_ref_alias_dimension", type_="check")
            b.create_check_constraint("ck_ref_alias_dimension", f"dimension IN ({AVANT})")
    else:
        _contrainte_alias(AVANT)
