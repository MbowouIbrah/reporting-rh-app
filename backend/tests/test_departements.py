"""Départements : référentiel, rattachement des services, droits et import CSV."""

from alembic.config import Config
from sqlalchemy import create_engine, inspect, select, text

from alembic import command
from app.core.config import settings
from app.models.auth import AuditEvent, UtilisateurPortee
from app.models.referentiel import Departement, RefAlias, Service
from app.repos.scope import scope_for
from app.security.policy import Portee, Principal
from tests.conftest import PW
from tests.identites import courriel
from tests.test_import_paie import employe, envoyer

API = "/api/v1"
ADMIN, DRH = courriel("admin"), courriel("drh")


def dep_id(db, libelle):
    return db.scalar(select(Departement.id).where(Departement.libelle == libelle))


def srv(db, libelle):
    return db.scalar(select(Service).where(Service.libelle == libelle))


# ---- migration ----

def test_0028_departements_rattachement_et_descente(tmp_path, monkeypatch):
    url = f"sqlite+pysqlite:///{tmp_path / 'd.db'}"
    monkeypatch.setattr(settings, "DATABASE_URL", url)
    cfg = Config("alembic.ini")
    command.upgrade(cfg, "0027")
    eng = create_engine(url)
    with eng.begin() as c:
        c.execute(text("INSERT INTO service (id, libelle, actif) VALUES "
                       "(100, 'Service X', 1), (101, 'AUTOFAST', 1), (102, 'SAV PL', 1)"))
    command.upgrade(cfg, "0028")
    with eng.begin() as c:
        assert {r[0] for r in c.execute(text("SELECT libelle FROM departement"))} == {
            "Equipment", "Winpart"}
        liens = dict(c.execute(text(
            "SELECT s.libelle, d.libelle FROM service s JOIN departement d "
            "ON d.id = s.departement_id")).all())
        assert liens["Service X"] == "Equipment" and liens["AUTOFAST"] == "Winpart"
        assert liens["SAV PL"] == "Equipment"
        assert c.execute(text("SELECT count(*) FROM service WHERE departement_id IS NULL")
                         ).scalar() == 0
        c.execute(text("INSERT INTO ref_alias (dimension, alias_norm, cible_id) "
                       "VALUES ('departement', 'eq', 1)"))
        c.execute(text("INSERT INTO utilisateur (id, email, nom, password_hash, actif, cree_le) "
                       f"VALUES (1, '{courriel('a')}', 'A', 'h', 1, '2026-01-01')"))
        c.execute(text("INSERT INTO utilisateur_portee (utilisateur_id, type, valeur) "
                       "VALUES (1, 'departement', 'Winpart'), (1, 'service', 'SAV PL')"))
    command.downgrade(cfg, "0027")
    insp = inspect(eng)
    assert "departement" not in insp.get_table_names()
    assert "departement_id" not in {x["name"] for x in insp.get_columns("service")}
    with eng.begin() as c:
        assert c.execute(text("SELECT count(*) FROM service WHERE id >= 100")).scalar() == 3
        assert c.execute(text("SELECT count(*) FROM ref_alias WHERE dimension = 'departement'")
                         ).scalar() == 0
        assert c.execute(text("SELECT type FROM utilisateur_portee")).all() == [("service",)]
    command.upgrade(cfg, "head")


# ---- référentiel ----

def test_graine_rattache_les_services(db):
    assert {d.libelle for d in db.scalars(select(Departement))} == {"Equipment", "Winpart"}
    win, equip = dep_id(db, "Winpart"), dep_id(db, "Equipment")
    assert {srv(db, x).departement_id for x in ("Winpart", "Motul", "Autofast")} == {win}
    assert srv(db, "SAV PL").departement_id == equip


def test_referentiel_departement_crud(db, make_client):
    c = make_client(ADMIN)
    liste = c.get(f"{API}/referentiels/departement").json()["valeurs"]
    assert {v["libelle"] for v in liste} == {"Equipment", "Winpart"}
    r = c.post(f"{API}/referentiels/departement", json={"libelle": "Lubrifiants"})
    assert r.status_code == 201, r.text
    nid = r.json()["id"]
    assert c.post(f"{API}/referentiels/departement", json={"libelle": "lubrifiants"}
                  ).status_code == 409
    assert c.put(f"{API}/referentiels/departement/{nid}", json={"actif": False}).status_code == 200
    db.expire_all()
    assert db.get(Departement, nid).actif is False
    assert c.put(f"{API}/referentiels/departement/{nid}", json={"libelle": "Winpart"}
                 ).status_code == 409
    assert c.put(f"{API}/referentiels/departement/999", json={"actif": False}).status_code == 404
    # un département n'a pas de département
    assert c.put(f"{API}/referentiels/departement/{nid}", json={"departement_id": nid}
                 ).status_code == 422
    assert make_client(DRH).post(f"{API}/referentiels/departement", json={"libelle": "X"}
                                 ).status_code == 403


def test_service_rattache_detache_et_refus(db, make_client):
    c = make_client(ADMIN)
    sid = srv(db, "SAV PL").id
    win = dep_id(db, "Winpart")
    valeurs = c.get(f"{API}/referentiels/service").json()["valeurs"]
    assert next(v for v in valeurs if v["id"] == sid)["departement_id"] == dep_id(db, "Equipment")
    assert c.put(f"{API}/referentiels/service/{sid}", json={"departement_id": win}
                 ).status_code == 200
    db.expire_all()
    assert srv(db, "SAV PL").departement_id == win
    # une modification sans departement_id ne le touche pas
    assert c.put(f"{API}/referentiels/service/{sid}", json={"actif": True}).status_code == 200
    db.expire_all()
    assert srv(db, "SAV PL").departement_id == win
    ev = db.scalars(select(AuditEvent).where(AuditEvent.entite == "ref_service")).all()
    assert ev[0].avant["departement_id"] == dep_id(db, "Equipment")
    assert ev[0].apres["departement_id"] == win
    assert c.put(f"{API}/referentiels/service/{sid}", json={"departement_id": 9999}
                 ).status_code == 422
    # null explicite : non rattaché
    assert c.put(f"{API}/referentiels/service/{sid}", json={"departement_id": None}
                 ).status_code == 200
    db.expire_all()
    assert srv(db, "SAV PL").departement_id is None
    # seul un service porte un département
    site = c.get(f"{API}/referentiels/site").json()["valeurs"][0]["id"]
    assert c.put(f"{API}/referentiels/site/{site}", json={"departement_id": win}
                 ).status_code == 422


def test_renommage_propage_alias_et_droits(db, make_client):
    c = make_client(ADMIN)
    r = c.post(f"{API}/users", json={
        "email": courriel("w"), "nom": "W", "password": PW, "permissions": [],
        "portee": {"departements": ["Winpart"]}})
    assert r.status_code == 201, r.text
    assert r.json()["portee"]["departements"] == ["Winpart"]
    win = dep_id(db, "Winpart")
    r = c.put(f"{API}/referentiels/departement/{win}", json={"libelle": "Pieces"})
    assert r.status_code == 200, r.text
    db.expire_all()
    vals = list(db.scalars(select(UtilisateurPortee.valeur).where(
        UtilisateurPortee.type == "departement")))
    assert vals == ["Pieces"]
    assert db.scalar(select(RefAlias.cible_id).where(
        RefAlias.dimension == "departement", RefAlias.alias_norm == "winpart")) == win


# ---- droits ----

def test_scope_par_departement(db):
    p = Principal(1, "u@x", portee=Portee(departements=frozenset({"Winpart"})))
    assert not p.portee.vide
    scope = scope_for(db, p)
    assert scope.rules == {"service": frozenset({"Winpart", "Motul", "Autofast"})}
    # un service rattaché plus tard entre dans le périmètre ; un service détaché en sort
    srv(db, "SAV PL").departement_id = dep_id(db, "Winpart")
    srv(db, "Motul").departement_id = None
    db.flush()
    assert scope_for(db, p).rules["service"] == frozenset({"Winpart", "SAV PL", "Autofast"})
    # union avec les services accordés
    p2 = Principal(1, "u@x", portee=Portee(services=frozenset({"Pneumatique"}),
                                           departements=frozenset({"Winpart"})))
    assert "Pneumatique" in scope_for(db, p2).rules["service"]
    # département sans service + un site : aucun service visible, pas tous ceux du site
    db.add(Departement(libelle="Motors"))
    db.flush()
    p3 = Principal(1, "u@x", portee=Portee(sites=frozenset({"Douala"}),
                                           departements=frozenset({"Motors"})))
    assert scope_for(db, p3).rules == {"service": frozenset(), "site": frozenset({"Douala"})}


def test_compte_departement_inconnu_refuse(db, make_client):
    c = make_client(ADMIN)
    r = c.post(f"{API}/users", json={"email": courriel("z"), "nom": "Z", "password": PW,
                                     "permissions": [], "portee": {"departements": ["Nul"]}})
    assert r.status_code == 422
    r = c.post(f"{API}/users", json={"email": courriel("z"), "nom": "Z", "password": PW,
                                     "permissions": [], "portee": {"departements": ["Winpart"]}})
    uid = r.json()["id"]
    assert c.put(f"{API}/users/{uid}", json={"portee": {"services": ["SAV PL"]}}).status_code == 200
    assert c.get(f"{API}/users").json()
    u = next(x for x in c.get(f"{API}/users").json() if x["id"] == uid)
    assert u["portee"]["departements"] == [] and u["portee"]["services"] == ["SAV PL"]


# ---- import CSV ----

def ajouter_service(c, lot, libelle):
    r = c.post(f"{API}/imports/{lot['id']}/decisions", json={"ajouts": [
        {"dimension": "service", "valeur": libelle}]})
    assert r.status_code == 200 and r.json()["statut"] == "pret", r.text
    assert c.post(f"{API}/imports/{lot['id']}/valider").json()["statut"] == "valide"


def poser_poste(db):
    from tests.test_import_paie import poser_poste as poser
    poser(db)


def test_import_rattache_le_service_cree(db, make_client):
    poser_poste(db)
    c = make_client(ADMIN)
    lot = envoyer(c, [employe(**{"Intitulé service": "Lubrifiants",
                                 "Intitulé département": "winpart"})]).json()
    assert lot["statut"] == "rejete"
    ajouter_service(c, lot, "Lubrifiants")
    db.expire_all()
    assert srv(db, "Lubrifiants").departement_id == dep_id(db, "Winpart")


def test_import_departement_par_alias_et_inconnu(db, make_client):
    poser_poste(db)
    db.add(RefAlias(dimension="departement", alias_norm="pieces detachees",
                    cible_id=dep_id(db, "Winpart")))
    db.commit()
    c = make_client(ADMIN)
    lot = envoyer(c, [employe(**{"Intitulé service": "Neuf A",
                                 "Intitulé département": "Pièces détachées"})]).json()
    ajouter_service(c, lot, "Neuf A")
    lot = envoyer(c, [employe(Matricule="E2", **{"Intitulé service": "Neuf B",
                                                  "Intitulé département": "Inconnu"})],
                  nom="BrutFinal1126.csv").json()
    ajouter_service(c, lot, "Neuf B")
    db.expire_all()
    assert srv(db, "Neuf A").departement_id == dep_id(db, "Winpart")
    assert srv(db, "Neuf B").departement_id is None


def test_import_ne_change_pas_un_service_existant(db, make_client):
    poser_poste(db)
    c = make_client(ADMIN)
    avant = srv(db, "SAV PL").departement_id
    lot = envoyer(c, [employe(**{"Intitulé département": "Winpart"})]).json()
    assert lot["statut"] == "pret", lot
    assert c.post(f"{API}/imports/{lot['id']}/valider").json()["statut"] == "valide"
    db.expire_all()
    assert srv(db, "SAV PL").departement_id == avant == dep_id(db, "Equipment")
