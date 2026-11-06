from sqlalchemy import select

from app.models.auth import AuditEvent, PerimetreRegle
from app.models.referentiel import Service, Site
from tests import test_rapports_api as rapports
from tests.identites import courriel
from tests.test_import_api import XLSX
from tests.test_import_regles import ligne, xlsx

API, EQUIP, D, get = rapports.API, rapports.EQUIP, rapports.D, rapports.get
charge = rapports.charge  # fixture partagée


def sid(db, libelle):
    return db.scalar(select(Service.id).where(Service.libelle == libelle))


def test_renommage_propage_perimetre_alias_audit(charge, make_client, db):
    c = charge
    rid = sid(db, "SAV PL")
    apercu = c.put(f"{API}/referentiels/service/{rid}", params={"apercu": True},
                   json={"libelle": "SAV Poids Lourds"})
    assert apercu.json()["perimetres_maj"] == 2  # DPS et SAV PL
    assert db.get(Service, rid).libelle == "SAV PL"  # aperçu : rien d'écrit
    r = c.put(f"{API}/referentiels/service/{rid}", json={"libelle": "SAV Poids Lourds"})
    assert r.status_code == 200 and r.json()["perimetres_maj"] == 2
    db.expire_all()
    assert db.scalar(select(PerimetreRegle.id).where(PerimetreRegle.valeur == "SAV PL")) is None
    # le lecteur de périmètre voit toujours ses données
    equip = get(make_client(EQUIP), "mensuel", annee=2026, mois=1).json()
    assert D(equip["synthese"]["ms"]["m"]) == D("1000.5")
    # un import avec l'ancien libellé est résolu
    lot = c.post(f"{API}/imports", files={"fichier": ("n.xlsx", xlsx([ligne(MOIS="Mars")]), XLSX)}
                 ).json()
    assert lot["statut"] == "pret", lot
    ev = db.scalars(select(AuditEvent).where(AuditEvent.entite == "ref_service")).one()
    assert ev.avant["libelle"] == "SAV PL" and ev.apres["libelle"] == "SAV Poids Lourds"


def test_renommage_refus(charge, make_client, db):
    c = charge
    a, b = sid(db, "SAV PL"), sid(db, "Administration")
    assert c.put(f"{API}/referentiels/service/{a}", json={"libelle": "Administration"}
                 ).status_code == 409
    assert c.put(f"{API}/referentiels/service/999", json={"libelle": "Z"}).status_code == 404
    assert make_client(courriel("drh")).put(
        f"{API}/referentiels/service/{b}", json={"libelle": "Z"}).status_code == 403
    rub = c.get(f"{API}/referentiels/rubrique").json()["valeurs"]
    absences = next(r["id"] for r in rub if r["libelle"] == "Absences (nb)")
    assert c.put(f"{API}/referentiels/rubrique/{absences}", json={"libelle": "X"}
                 ).status_code == 409
    # colonne du reporting individuel : la renommer viderait la colonne
    logement = next(r["id"] for r in rub if r["libelle"] == "Logement site déporté")
    r = c.put(f"{API}/referentiels/rubrique/{logement}", json={"libelle": "Logement"})
    assert r.status_code == 409 and "individuel" in r.json()["detail"]
    formation = next(r["id"] for r in rub if r["libelle"] == "Formation")
    assert c.put(f"{API}/referentiels/rubrique/{formation}", json={"libelle": "Formations"}
                 ).status_code == 200
    assert c.put(f"{API}/referentiels/service/{b}", json={"actif": False}).status_code == 200


def test_type_de_site_modifiable_et_valide(charge, db):
    c = charge
    sites = c.get(f"{API}/referentiels/site").json()["valeurs"]
    assert {s["type_site"] for s in sites} == {"principal"}
    rid = db.scalar(select(Site.id).where(Site.libelle == "Douala"))
    r = c.put(f"{API}/referentiels/site/{rid}", json={"type_site": "deporte"})
    assert r.status_code == 200 and r.json()["type_site"] == "deporte"
    db.expire_all()
    assert db.get(Site, rid).type_site == "deporte"
    ev = db.scalars(select(AuditEvent).where(AuditEvent.action == "update")).all()[-1]
    assert "deporte" in str(ev.apres) and "principal" in str(ev.avant)
    assert c.put(f"{API}/referentiels/site/{rid}", json={"type_site": "x"}).status_code == 422
    sid_ = sid(db, "SAV PL")
    assert c.put(f"{API}/referentiels/service/{sid_}",
                 json={"type_site": "agence"}).status_code == 422


def test_creation_site_avec_type_et_service(charge, db):
    c = charge
    r = c.post(f"{API}/referentiels/site", json={"libelle": "  Maroua ", "type_site": "agence"})
    assert r.status_code == 201
    assert r.json() == {"id": r.json()["id"], "libelle": "Maroua", "actif": True,
                        "type_site": "agence"}
    assert r.json() in c.get(f"{API}/referentiels/site").json()["valeurs"]  # même format que GET
    d = c.post(f"{API}/referentiels/site", json={"libelle": "Bafoussam"}).json()
    assert d["type_site"] == "principal"
    s = c.post(f"{API}/referentiels/service", json={"libelle": "Qualité"})
    assert s.status_code == 201 and "type_site" not in s.json() and s.json()["actif"] is True
    assert s.json() in c.get(f"{API}/referentiels/service").json()["valeurs"]
    db.expire_all()
    assert db.get(Site, r.json()["id"]).type_site == "agence"
    ev = db.scalars(select(AuditEvent).where(AuditEvent.action == "create",
                                             AuditEvent.entite == "ref_site")).all()
    assert len(ev) == 2 and ev[0].avant is None and ev[0].apres["libelle"] == "Maroua"


def test_creation_refus(charge, db, make_client):
    c = charge
    assert c.post(f"{API}/referentiels/service", json={"libelle": "Administration"}
                  ).status_code == 409
    # comparaison sans accents ni casse
    assert c.post(f"{API}/referentiels/service", json={"libelle": "administration "}
                  ).status_code == 409
    # ancien libellé d'un renommage : alias d'une autre valeur
    a = sid(db, "SAV PL")
    assert c.put(f"{API}/referentiels/service/{a}", json={"libelle": "SAV Poids Lourds"}
                 ).status_code == 200
    r = c.post(f"{API}/referentiels/service", json={"libelle": "sav pl"})
    assert r.status_code == 409 and "alias" in r.json()["detail"]
    assert c.post(f"{API}/referentiels/service", json={"libelle": "   "}).status_code == 422
    assert c.post(f"{API}/referentiels/site", json={"libelle": "X", "type_site": "zz"}
                  ).status_code == 422
    assert c.post(f"{API}/referentiels/service", json={"libelle": "X", "type_site": "agence"}
                  ).status_code == 422
    assert c.post(f"{API}/referentiels/rubrique", json={"libelle": "X"}).status_code == 422
    assert c.post(f"{API}/referentiels/poste", json={"libelle": "X"}).status_code == 422
    assert c.post(f"{API}/referentiels/inconnue", json={"libelle": "X"}).status_code == 404
    lecteur = make_client(courriel("drh"))
    assert lecteur.post(f"{API}/referentiels/site", json={"libelle": "Nord"}).status_code == 403
    assert db.scalar(select(Site.id).where(Site.libelle == "Nord")) is None
