from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from alembic import command
from app.core.config import settings

TABLES = {"perimetre", "perimetre_regle", "utilisateur", "utilisateur_permission",
          "utilisateur_portee", "audit_event"}
TABLES3 = {"service", "periode", "salarie", "situation_mensuelle", "montant", "lot_import",
           "staging_ligne", "import_anomalie", "rubrique_regle", "budget"}


def test_montee_et_descente(tmp_path, monkeypatch):
    url = f"sqlite+pysqlite:///{tmp_path / 'm.db'}"
    monkeypatch.setattr(settings, "DATABASE_URL", url)
    cfg = Config("alembic.ini")
    command.upgrade(cfg, "head")
    insp = inspect(create_engine(url))
    assert "statut" not in {c["name"] for c in insp.get_columns("periode")}
    assert any("mois" in c["sqltext"] for c in insp.get_check_constraints("periode"))
    assert TABLES <= set(inspect(create_engine(url)).get_table_names())
    assert TABLES3 <= set(inspect(create_engine(url)).get_table_names())
    assert "role_assignment" not in insp.get_table_names()
    assert "marge" in {c["name"] for c in insp.get_columns("ca_periode")}
    command.downgrade(cfg, "0007")
    cols = {c["name"] for c in inspect(create_engine(url)).get_columns("ca_periode")}
    assert "marge" not in cols and "valeur" in cols
    command.downgrade(cfg, "0001")
    assert not TABLES & set(inspect(create_engine(url)).get_table_names())
    command.upgrade(cfg, "head")


def test_0014_convertit_les_roles(tmp_path, monkeypatch):
    url = f"sqlite+pysqlite:///{tmp_path / 'r.db'}"
    monkeypatch.setattr(settings, "DATABASE_URL", url)
    cfg = Config("alembic.ini")
    command.upgrade(cfg, "0013")
    eng = create_engine(url)
    with eng.begin() as c:
        pid = c.execute(text("SELECT id FROM perimetre WHERE code = 'dps'")).scalar()
        for i, email in enumerate(("a@x", "g@x", "p@x", "n@x", "m@x"), start=1):
            c.execute(text("INSERT INTO utilisateur (id, email, nom, password_hash, actif, cree_le) "
                           "VALUES (:i, :e, :e, 'h', 1, '2026-01-01')"), {"i": i, "e": email})
        for uid, role, p, nom in ((1, "rh_admin", None, 0), (2, "lecteur_global", None, 0),
                                  (3, "lecteur_perimetre", pid, 0),
                                  (4, "lecteur_perimetre", pid, 1),
                                  (5, "lecteur_perimetre", pid, 0), (5, "lecteur_global", None, 0)):
            c.execute(text("INSERT INTO role_assignment (utilisateur_id, role, perimetre_id, "
                           "nominatif) VALUES (:u, :r, :p, :n)"),
                      {"u": uid, "r": role, "p": p, "n": nom})
    command.upgrade(cfg, "0014")
    with eng.connect() as c:
        def droits(uid):
            f = c.execute(text("SELECT fonction FROM utilisateur WHERE id = :i"), {"i": uid}).scalar()
            perms = sorted(c.execute(text("SELECT permission FROM utilisateur_permission "
                                          "WHERE utilisateur_id = :i"), {"i": uid}).scalars())
            portees = sorted(tuple(r) for r in c.execute(text(
                "SELECT type, perimetre_id FROM utilisateur_portee WHERE utilisateur_id = :i"),
                {"i": uid}))
            return f, perms, portees

        assert droits(1) == ("Administrateur RH", ["comptes", "import", "journal", "marge",
                                                   "nominatif", "referentiel", "saisie"],
                             [("tout", None)])
        assert droits(2) == ("Lecteur global", ["marge", "nominatif"], [("tout", None)])
        assert droits(3) == ("Lecteur de périmètre", [], [("perimetre", pid)])
        assert droits(4) == ("Lecteur de périmètre", ["nominatif"], [("perimetre", pid)])
        assert droits(5) == ("Lecteur global", ["marge", "nominatif"], [("tout", None)])
    command.downgrade(cfg, "0013")
    with eng.connect() as c:
        roles = c.execute(text("SELECT utilisateur_id, role, nominatif FROM role_assignment "
                               "ORDER BY utilisateur_id")).all()
    assert [(u, r) for u, r, _ in roles] == [(1, "rh_admin"), (2, "lecteur_global"),
                                             (3, "lecteur_perimetre"), (4, "lecteur_perimetre"),
                                             (5, "lecteur_global")]
    assert [bool(n) for *_, n in roles] == [True, True, False, True, True]


def test_0016_donnees_activite(tmp_path, monkeypatch):
    url = f"sqlite+pysqlite:///{tmp_path / 'a.db'}"
    monkeypatch.setattr(settings, "DATABASE_URL", url)
    cfg = Config("alembic.ini")
    command.upgrade(cfg, "0015")
    eng = create_engine(url)
    with eng.begin() as c:
        c.execute(text("INSERT INTO rubrique (libelle, unite, ordre, actif) "
                       "VALUES ('Brut Réel', 'FCFA', 1, 1)"))
        for i, lib in enumerate(("SAV PL", "SAV Engins", "Commerce VN"), start=1):
            c.execute(text("INSERT INTO service (id, libelle, actif) VALUES (:i, :l, 1)"),
                      {"i": i, "l": lib})
    command.upgrade(cfg, "head")
    with eng.begin() as c:
        nat = dict(c.execute(text("SELECT libelle, nature FROM rubrique")).all())
        assert nat["Brut Réel"] == "paie"
        assert [k for k, v in nat.items() if v == "activite"] == [
            "Nombre de ventes", "Nombre de clients", "Indice de productivité",
            "CA individuel", "Marge individuelle"]
        prod = {r[0] for r in c.execute(text("SELECT libelle FROM service WHERE productif"))}
        assert prod == {"SAV PL", "SAV Engins"}
        assert "reference_activite" in {x["name"] for x in inspect(c).get_columns(
            "situation_mensuelle")}
        assert "activite_saisie" in inspect(c).get_table_names()
    command.downgrade(cfg, "0015")
    with eng.begin() as c:
        assert not c.execute(text("SELECT 1 FROM rubrique WHERE libelle = 'CA individuel'")).all()
        assert "productif" not in {x["name"] for x in inspect(c).get_columns("service")}
