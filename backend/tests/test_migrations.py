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
    assert "valeur_saisie" in insp.get_table_names()
    assert "ca_periode" not in insp.get_table_names()
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
        assert "valeur_saisie" in inspect(c).get_table_names()
    command.downgrade(cfg, "0015")
    with eng.begin() as c:
        assert not c.execute(text("SELECT 1 FROM rubrique WHERE libelle = 'CA individuel'")).all()
        assert "productif" not in {x["name"] for x in inspect(c).get_columns("service")}


def test_0017_valeur_saisie_reprend_et_restitue(tmp_path, monkeypatch):
    url = f"sqlite+pysqlite:///{tmp_path / 'v.db'}"
    monkeypatch.setattr(settings, "DATABASE_URL", url)
    cfg = Config("alembic.ini")
    command.upgrade(cfg, "0016")
    eng = create_engine(url)
    with eng.begin() as c:
        for i in (1, 2):
            c.execute(text("INSERT INTO periode (id, annee, mois) VALUES (:i, 2026, :i)"), {"i": i})
        c.execute(text("INSERT INTO service (id, libelle, actif) VALUES (1, 'SAV', 1)"))
        c.execute(text("INSERT INTO site (id, libelle, actif) VALUES (1, 'Douala', 1)"))
        c.execute(text("INSERT INTO ca_periode (periode_id, valeur, marge) VALUES (1, 1000.5, 200)"))
        c.execute(text("INSERT INTO ca_periode (periode_id, valeur, marge) VALUES (2, 50, NULL)"))
        c.execute(text("INSERT INTO activite_saisie (periode_id, site_id, service_id, indicateur, "
                       "valeur) VALUES (1, 1, 1, 'or', 7.25)"))
    command.upgrade(cfg, "0017")
    with eng.connect() as c:
        tables = set(inspect(c).get_table_names())
        assert "valeur_saisie" in tables and not {"ca_periode", "activite_saisie"} & tables
        rows = sorted(c.execute(text("SELECT periode_id, indicateur, site_id, service_id, valeur "
                                     "FROM valeur_saisie")).all())
    assert [(r[0], r[1], r[2], r[3], float(r[4])) for r in rows] == [
        (1, "ca", None, None, 1000.5), (1, "marge", None, None, 200.0),
        (1, "or", 1, 1, 7.25), (2, "ca", None, None, 50.0)]
    with eng.begin() as c:  # l'unicité traite les niveaux sans site ni service comme des valeurs
        try:
            c.execute(text("INSERT INTO valeur_saisie (periode_id, indicateur, valeur) "
                           "VALUES (1, 'ca', 1)"))
            doublon = False
        except Exception:
            doublon = True
    assert doublon
    command.downgrade(cfg, "0016")
    with eng.connect() as c:
        assert "valeur_saisie" not in inspect(c).get_table_names()
        ca = sorted((r[0], float(r[1]), None if r[2] is None else float(r[2])) for r in c.execute(
            text("SELECT periode_id, valeur, marge FROM ca_periode")))
        assert ca == [(1, 1000.5, 200.0), (2, 50.0, None)]
        assert [(r[0], r[1], r[2], r[3], float(r[4])) for r in c.execute(text(
            "SELECT periode_id, site_id, service_id, indicateur, valeur FROM activite_saisie"))
        ] == [(1, 1, 1, "or", 7.25)]
    command.upgrade(cfg, "head")
