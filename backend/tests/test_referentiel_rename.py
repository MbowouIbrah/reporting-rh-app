from sqlalchemy import select

from app.models.auth import AuditEvent, PerimetreRegle
from app.models.referentiel import Service
from tests import test_rapports_api as rapports
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
    assert apercu.json()["perimetres_maj"] == 1
    assert db.get(Service, rid).libelle == "SAV PL"  # aperçu : rien d'écrit
    r = c.put(f"{API}/referentiels/service/{rid}", json={"libelle": "SAV Poids Lourds"})
    assert r.status_code == 200 and r.json()["perimetres_maj"] == 1
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
    assert make_client("drh@exemple.invalid").put(
        f"{API}/referentiels/service/{b}", json={"libelle": "Z"}).status_code == 403
    rub = c.get(f"{API}/referentiels/rubrique").json()["valeurs"]
    absences = next(r["id"] for r in rub if r["libelle"] == "Absences (nb)")
    assert c.put(f"{API}/referentiels/rubrique/{absences}", json={"libelle": "X"}
                 ).status_code == 409
    assert c.put(f"{API}/referentiels/service/{b}", json={"actif": False}).status_code == 200
