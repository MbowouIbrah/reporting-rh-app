"""services SAV Chariot, Winpart, Motul, Autofast ; perimetres Equipment et Winpart (retours N2)

SAV Chariot est productif et rejoint le DPS. Equipment : ce que voit le DOP Equipment ;
Winpart : Winpart, Motul, Autofast.

Revision ID: 0025
Revises: 0024
"""
from alembic import op
import sqlalchemy as sa


revision = '0025'
down_revision = '0024'
branch_labels = None
depends_on = None

SERVICES = {"SAV Chariot": True, "Winpart": False, "Motul": False, "Autofast": False}
PERIMETRES = {
    "dps": ("DPS", ["Commerce Pièces", "SAV PL", "SAV Engins", "SAV Chariot", "Sites Déportés"]),
    "equipment": ("Equipment", ["Commerce Pièces", "SAV PL", "SAV Engins", "SAV Chariot",
                                "Sites Déportés", "Pneumatique"]),
    "winpart": ("Winpart", ["Winpart", "Motul", "Autofast"]),
}
DPS_AVANT = ["Commerce Pièces", "SAV PL", "SAV Engins", "Sites Déportés"]


def _poser(conn, code: str, libelle: str, services: list[str]) -> None:
    pid = conn.execute(sa.text("SELECT id FROM perimetre WHERE code = :c"), {"c": code}).scalar()
    if pid is None:
        conn.execute(sa.text("INSERT INTO perimetre (code, libelle) VALUES (:c, :l)"),
                     {"c": code, "l": libelle})
        pid = conn.execute(sa.text("SELECT id FROM perimetre WHERE code = :c"),
                           {"c": code}).scalar()
    conn.execute(sa.text("DELETE FROM perimetre_regle WHERE perimetre_id = :i "
                         "AND dimension = 'service'"), {"i": pid})
    for s in services:
        conn.execute(sa.text("INSERT INTO perimetre_regle (perimetre_id, dimension, valeur) "
                             "VALUES (:i, 'service', :v)"), {"i": pid, "v": s})


def upgrade() -> None:
    conn = op.get_bind()
    for libelle, productif in SERVICES.items():
        conn.execute(sa.text(
            "INSERT INTO service (libelle, actif, productif) SELECT :l, true, :p "
            "WHERE NOT EXISTS (SELECT 1 FROM service WHERE libelle = :l)"),
            {"l": libelle, "p": productif})
    for code, (libelle, services) in PERIMETRES.items():
        _poser(conn, code, libelle, services)


def downgrade() -> None:
    conn = op.get_bind()
    _poser(conn, "dps", "DPS", DPS_AVANT)
    # Un perimetre encore attribue a un compte est conserve.
    libres = ("SELECT id FROM perimetre WHERE code = :c AND id NOT IN "
              "(SELECT perimetre_id FROM utilisateur_portee WHERE perimetre_id IS NOT NULL)")
    for code in ("equipment", "winpart"):
        conn.execute(sa.text(f"DELETE FROM perimetre_regle WHERE perimetre_id IN ({libres})"),
                     {"c": code})
        conn.execute(sa.text(f"DELETE FROM perimetre WHERE id IN ({libres})"), {"c": code})
    # Un service deja reference (paie, saisie) est conserve.
    utilise = " ".join(
        f"AND id NOT IN (SELECT service_id FROM {t} WHERE service_id IS NOT NULL)"
        for t in ("salarie", "situation_mensuelle", "valeur_saisie", "date_employes"))
    for libelle in SERVICES:
        conn.execute(sa.text(f"DELETE FROM service WHERE libelle = :l {utilise}"),
                     {"l": libelle})
