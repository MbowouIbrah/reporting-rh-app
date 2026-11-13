"""import direct de la paie : activite du poste et correspondance colonne de paie -> rubrique

poste.activite_id (facultatif) ; table correspondance_paie remplie avec la proposition par defaut
(une rubrique absente de la base est sautee).

Revision ID: 0026
Revises: 0025
"""
import re
import unicodedata

from alembic import op
import sqlalchemy as sa


revision = '0026'
down_revision = '0025'
branch_labels = None
depends_on = None

DEFAUT = {
    "Brut Réel": ["BRUT"],
    "Salaire brut garantie": ["SALAIRE DE BASE"],
    "Bonus": ["BONUS"],
    "Commission": ["COMMISSIONS"],
    "Primes exceptionnelles": ["PRIME EXCEPTIONNELLE"],
    "Productivité Ateliers": ["PRIME SUR RENDEMENT", "RAPPEL RENDEMENT"],
    "Logement site déporté": ["LOGEMENT DEPLACE"],
    "Charges Patronales": ["CNPS PAT", "AT PAT", "ALLOC FAM", "CF PAT", "FNE"],
    "Assurance Maladie": ["ASS. MALADIE"],
}


def _norm(v: str) -> str:
    s = unicodedata.normalize("NFKD", str(v).replace(" ", " ").strip())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).casefold()


def upgrade() -> None:
    with op.batch_alter_table("poste") as b:
        b.add_column(sa.Column("activite_id", sa.Integer(),
                               sa.ForeignKey("activite.id", name="fk_poste_activite"),
                               nullable=True))
    op.create_table(
        "correspondance_paie",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("colonne", sa.String(200), nullable=False),
        sa.Column("colonne_norm", sa.String(200), nullable=False, unique=True),
        sa.Column("rubrique_id", sa.Integer(), sa.ForeignKey("rubrique.id"), nullable=False),
    )
    conn = op.get_bind()
    for rubrique, colonnes in DEFAUT.items():
        rid = conn.execute(sa.text("SELECT id FROM rubrique WHERE libelle = :l"),
                           {"l": rubrique}).scalar()
        if rid is None:
            continue
        for colonne in colonnes:
            conn.execute(sa.text(
                "INSERT INTO correspondance_paie (colonne, colonne_norm, rubrique_id) "
                "VALUES (:c, :n, :r)"), {"c": colonne, "n": _norm(colonne), "r": rid})


def downgrade() -> None:
    op.drop_table("correspondance_paie")
    with op.batch_alter_table("poste") as b:
        b.drop_constraint("fk_poste_activite", type_="foreignkey")
        b.drop_column("activite_id")
