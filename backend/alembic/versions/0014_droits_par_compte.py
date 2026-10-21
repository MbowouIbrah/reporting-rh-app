"""droits par compte : fonction + portee + permissions (docs/etude-droits.md)

Les roles deviennent une fonction sans effet ; chaque compte porte ses donnees visibles
(utilisateur_portee) et ses permissions (utilisateur_permission). role_assignment est converti
puis supprime :
- rh_admin -> portee tout + toutes les permissions ;
- lecteur_global -> portee tout + nominatif + marge ;
- lecteur_perimetre -> portee = son perimetre (+ nominatif si le drapeau etait pose).

Revision ID: 0014
Revises: 0013
"""
from alembic import op
import sqlalchemy as sa


revision = '0014'
down_revision = '0013'
branch_labels = None
depends_on = None

TOUTES = ("nominatif", "marge", "import", "saisie", "referentiel", "comptes", "journal")
FONCTIONS = {"rh_admin": "Administrateur RH", "lecteur_global": "Lecteur global",
             "lecteur_perimetre": "Lecteur de périmètre"}
ORDRE = ("rh_admin", "lecteur_global", "lecteur_perimetre")


def upgrade() -> None:
    with op.batch_alter_table("utilisateur") as b:
        b.add_column(sa.Column("fonction", sa.String(200), nullable=False, server_default=""))
    op.create_table(
        "utilisateur_permission",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("utilisateur_id", sa.Integer,
                  sa.ForeignKey("utilisateur.id", ondelete="CASCADE"), nullable=False),
        sa.Column("permission", sa.String(30), nullable=False),
        sa.UniqueConstraint("utilisateur_id", "permission"),
    )
    op.create_table(
        "utilisateur_portee",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("utilisateur_id", sa.Integer,
                  sa.ForeignKey("utilisateur.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column("perimetre_id", sa.Integer, sa.ForeignKey("perimetre.id"), nullable=True),
        sa.Column("valeur", sa.String(200), nullable=True),
    )
    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT utilisateur_id, role, perimetre_id, nominatif FROM role_assignment "
        "ORDER BY utilisateur_id, id")).all()
    comptes: dict[int, dict] = {}
    for uid, role, pid, nominatif in rows:
        c = comptes.setdefault(uid, {"roles": set(), "perms": set(), "tout": False, "pids": set()})
        c["roles"].add(role)
        if role == "rh_admin":
            c["tout"] = True
            c["perms"].update(TOUTES)
        elif role == "lecteur_global":
            c["tout"] = True
            c["perms"].update({"nominatif", "marge"})
        elif role == "lecteur_perimetre" and pid is not None:
            c["pids"].add(pid)
            if nominatif:
                c["perms"].add("nominatif")
    for uid, c in comptes.items():
        role = next(r for r in ORDRE if r in c["roles"])
        conn.execute(sa.text("UPDATE utilisateur SET fonction = :f WHERE id = :i"),
                     {"f": FONCTIONS[role], "i": uid})
        for perm in sorted(c["perms"]):
            conn.execute(sa.text("INSERT INTO utilisateur_permission (utilisateur_id, permission) "
                                 "VALUES (:i, :p)"), {"i": uid, "p": perm})
        if c["tout"]:
            conn.execute(sa.text("INSERT INTO utilisateur_portee (utilisateur_id, type) "
                                 "VALUES (:i, 'tout')"), {"i": uid})
        else:
            for pid in sorted(c["pids"]):
                conn.execute(sa.text("INSERT INTO utilisateur_portee (utilisateur_id, type, "
                                     "perimetre_id) VALUES (:i, 'perimetre', :p)"),
                             {"i": uid, "p": pid})
    op.drop_table("role_assignment")


def downgrade() -> None:
    # Approximation : services et sites accordés un par un n'ont pas d'équivalent et sont perdus.
    # Les anciens rôles étant plus larges, un compte « tout » redescend en lecteur_global (qui
    # voyait marge et noms d'office) ou en rh_admin complet s'il gérait les comptes.
    op.create_table(
        "role_assignment",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("utilisateur_id", sa.Integer,
                  sa.ForeignKey("utilisateur.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(30), nullable=False),
        sa.Column("perimetre_id", sa.Integer, sa.ForeignKey("perimetre.id"), nullable=True),
        sa.Column("nominatif", sa.Boolean, nullable=False, server_default=sa.false()),
    )
    conn = op.get_bind()
    perms: dict[int, set[str]] = {}
    for uid, perm in conn.execute(sa.text(
            "SELECT utilisateur_id, permission FROM utilisateur_permission")):
        perms.setdefault(uid, set()).add(perm)
    portees: dict[int, list] = {}
    for uid, t, pid in conn.execute(sa.text(
            "SELECT utilisateur_id, type, perimetre_id FROM utilisateur_portee ORDER BY id")):
        portees.setdefault(uid, []).append((t, pid))
    ins = sa.text("INSERT INTO role_assignment (utilisateur_id, role, perimetre_id, nominatif) "
                  "VALUES (:i, :r, :p, :n)")
    for uid, lst in portees.items():
        p = perms.get(uid, set())
        nom = "nominatif" in p
        if any(t == "tout" for t, _ in lst):
            role = "rh_admin" if "comptes" in p else "lecteur_global"
            conn.execute(ins, {"i": uid, "r": role, "p": None, "n": nom})
            continue
        for t, pid in lst:
            if t == "perimetre":
                conn.execute(ins, {"i": uid, "r": "lecteur_perimetre", "p": pid, "n": nom})
    op.drop_table("utilisateur_portee")
    op.drop_table("utilisateur_permission")
    with op.batch_alter_table("utilisateur") as b:
        b.drop_column("fonction")
