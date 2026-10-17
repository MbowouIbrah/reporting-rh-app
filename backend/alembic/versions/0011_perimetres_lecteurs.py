"""perimetres des lecteurs (retours de la 2e presentation, lot 5)

Le perimetre Equipment devient celui du DPS (Commerce Pieces, SAV PL, SAV Engins, Sites
Deportes) ; les affectations existantes le suivent. Ajout des perimetres d'un seul service.

Revision ID: 0011
Revises: 0010
"""
from alembic import op
import sqlalchemy as sa


revision = '0011'
down_revision = '0010'
branch_labels = None
depends_on = None

PERIMETRES = {
    "dps": ("DPS", ["Commerce Pièces", "SAV PL", "SAV Engins", "Sites Déportés"]),
    "commerce_vn": ("Commerce VN", ["Commerce VN"]),
    "pneumatique": ("Pneumatique", ["Pneumatique"]),
    "sav_pl": ("SAV PL", ["SAV PL"]),
    "sav_engins": ("SAV Engins", ["SAV Engins"]),
    "sites_deportes": ("Sites Déportés", ["Sites Déportés"]),
}
EQUIPMENT = ("Equipment", ["SAV PL", "SAV Engins", "Pneumatique", "Sites Déportés"])


def _poser(conn, code: str, libelle: str, services: list[str]) -> None:
    pid = conn.execute(sa.text("SELECT id FROM perimetre WHERE code = :c"), {"c": code}).scalar()
    if pid is None:
        conn.execute(sa.text("INSERT INTO perimetre (code, libelle) VALUES (:c, :l)"),
                     {"c": code, "l": libelle})
        pid = conn.execute(sa.text("SELECT id FROM perimetre WHERE code = :c"),
                           {"c": code}).scalar()
    else:
        conn.execute(sa.text("UPDATE perimetre SET libelle = :l WHERE id = :i"),
                     {"l": libelle, "i": pid})
    conn.execute(sa.text("DELETE FROM perimetre_regle WHERE perimetre_id = :i"), {"i": pid})
    for s in services:
        conn.execute(sa.text("INSERT INTO perimetre_regle (perimetre_id, dimension, valeur) "
                             "VALUES (:i, 'service', :v)"), {"i": pid, "v": s})


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text(
        "UPDATE perimetre SET code = 'dps' WHERE code = 'equipment' "
        "AND NOT EXISTS (SELECT 1 FROM perimetre WHERE code = 'dps')"))
    for code, (libelle, services) in PERIMETRES.items():
        _poser(conn, code, libelle, services)


def downgrade() -> None:
    conn = op.get_bind()
    # Un perimetre encore attribue a un compte est conserve.
    libres = ("SELECT id FROM perimetre WHERE code = :c AND id NOT IN "
              "(SELECT perimetre_id FROM role_assignment WHERE perimetre_id IS NOT NULL)")
    for code in ("pneumatique", "sav_pl", "sav_engins", "sites_deportes"):
        conn.execute(sa.text(f"DELETE FROM perimetre_regle WHERE perimetre_id IN ({libres})"),
                     {"c": code})
        conn.execute(sa.text(f"DELETE FROM perimetre WHERE id IN ({libres})"), {"c": code})
    conn.execute(sa.text("UPDATE perimetre SET code = 'equipment' WHERE code = 'dps'"))
    _poser(conn, "equipment", *EQUIPMENT)
