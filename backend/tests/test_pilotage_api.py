from decimal import Decimal as D

from sqlalchemy import func, select

from app.models.auth import AuditEvent
from app.models.donnees import Periode
from app.models.pilotage import Budget

API = "/api/v1"
ADMIN, DRH, EQUIP = "admin@exemple.invalid", "drh@exemple.invalid", "dps.equipment@exemple.invalid"


def lire(c, annee=2026, mois=10):
    return c.get(f"{API}/pilotage", params={"annee": annee, "mois": mois})


def ca_marge(c, ca, marge, annee=2026, mois=10):
    """Saisie globale du CA et de la marge ; renvoie la vue du mois (ou l'erreur de la saisie)."""
    r = c.put(f"{API}/pilotage/saisies",
              json={"annee": annee, "mois": mois, "groupe": "ca_marge", "niveau": "global",
                    "cases": [{"valeurs": {"ca": ca, "marge": marge}}]})
    return lire(c, annee, mois) if r.status_code == 200 else r


def budgets(c, lignes, annee=2026, mois=10):
    return c.put(f"{API}/pilotage/budgets", json={"annee": annee, "mois": mois, "lignes": lignes})


def nb_periodes(db):
    return db.scalar(select(func.count()).select_from(Periode))


def test_lecture_ne_cree_pas_de_periode(db, make_client):
    r = lire(make_client(ADMIN))
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["periode_id"] is None and j["ca"] is None and j["marge"] is None
    assert j["taux_marge"] is None and j["reprise"] is None
    assert {"rubrique", "service", "site"} == set(j["budgets"]) and j["budgets"]["service"]
    assert all(x["valeur"] is None for x in j["budgets"]["rubrique"])
    assert nb_periodes(db) == 0


def test_droits(db, make_client):
    assert lire(make_client(EQUIP)).status_code == 403  # pas de marge:read
    assert lire(make_client(DRH)).status_code == 403  # lecteur : pas d'accès à la saisie
    assert ca_marge(make_client(DRH), "1", "1").status_code == 403
    assert budgets(make_client(DRH), []).status_code == 403
    assert nb_periodes(db) == 0


def test_ca_marge_ouvre_le_mois_et_trace(db, make_client):
    c = make_client(ADMIN)
    r = ca_marge(c, "1 000,5".replace(" ", ""), "-200")  # la marge peut être négative
    assert r.status_code == 200, r.text
    j = r.json()
    assert (j["ca"], j["marge"]) == ("1000.500", "-200.000")
    assert D(j["taux_marge"]) == D("-200") / D("1000.5")
    assert nb_periodes(db) == 1
    actions = db.scalars(select(AuditEvent.action).order_by(AuditEvent.id)).all()
    assert actions[-2:] == ["ouverture", "saisie_pilotage"]
    # CA seul : la marge est effacée, le taux disparaît
    j = ca_marge(c, "500", None).json()
    assert j["ca"] == "500.000" and j["marge"] is None and j["taux_marge"] is None
    assert ca_marge(c, "0", "10").json()["taux_marge"] == "n/a"
    # tout effacer garde le mois ouvert mais sans saisie
    assert ca_marge(c, None, None).json()["ca"] is None and nb_periodes(db) == 1


def test_envoi_sans_changement_et_route_heritee(db, make_client):
    c = make_client(ADMIN)
    pid = ca_marge(c, "1000", "-0").json()["periode_id"]
    assert ca_marge(c, "1000", "0").json()["marge"] == "0.000"  # « -0 » enregistré 0
    nb = db.scalar(select(func.count()).select_from(AuditEvent))
    ca_marge(c, "1000", "0")
    budgets(c, [{"axe": "service", "cible_id": 1, "valeur": None}])
    assert db.scalar(select(func.count()).select_from(AuditEvent)) == nb  # rien changé, rien tracé
    # ancienne route : effacer le CA efface aussi la marge
    r = c.put(f"{API}/periodes/{pid}/ca", json={"valeur": ""})
    assert r.status_code == 200, r.text
    assert r.json()["ca"] is None and r.json()["marge"] is None


def test_ca_marge_refus(db, make_client):
    c = make_client(ADMIN)
    assert ca_marge(c, None, "10").status_code == 422  # marge sans CA
    assert ca_marge(c, "", "10").status_code == 422
    assert ca_marge(c, "-1", None).status_code == 422  # CA négatif
    assert ca_marge(c, "abc", None).status_code == 422
    assert ca_marge(c, "1", "1", mois=13).status_code == 422
    assert ca_marge(c, None, None).status_code == 200  # rien à écrire
    assert nb_periodes(db) == 0


def test_budgets_totaux_exclues_et_reprise(db, make_client):
    c = make_client(ADMIN)
    vue = lire(c).json()
    rub = vue["budgets"]["rubrique"]
    compte = next(x for x in rub if not x["exclue"])
    exclue = next(x for x in rub if x["exclue"])
    site = vue["budgets"]["site"][0]
    r = budgets(c, [
        {"axe": "rubrique", "cible_id": compte["cible_id"], "valeur": "1000"},
        {"axe": "rubrique", "cible_id": exclue["cible_id"], "valeur": "50"},
        {"axe": "site", "cible_id": site["cible_id"], "valeur": "12000000"},
    ], mois=9)
    assert r.status_code == 200, r.text
    j = r.json()
    assert D(j["totaux"]["rubrique"]) == 1000  # exclue hors total
    assert D(j["totaux"]["site"]) == 12_000_000 and j["totaux"]["service"] is None
    assert j["reprise"] is None
    # octobre vide : reprise proposée depuis septembre, rien n'est enregistré
    oct_ = lire(c).json()
    assert oct_["reprise"]["mois"] == 9 and oct_["periode_id"] is None
    assert oct_["reprise"]["valeurs"]["site"][str(site["cible_id"])] == "12000000.000"
    assert db.scalar(select(func.count()).select_from(Budget)) == 3
    # effacer une ligne
    j = budgets(c, [{"axe": "site", "cible_id": site["cible_id"], "valeur": ""}], mois=9).json()
    assert j["totaux"]["site"] is None


def test_budgets_refus_sans_ouvrir(db, make_client):
    c = make_client(ADMIN)
    assert budgets(c, [{"axe": "service", "cible_id": 9999, "valeur": "1"}]).status_code == 422
    assert budgets(c, [{"axe": "service", "cible_id": 1, "valeur": "-1"}]).status_code == 422
    assert budgets(c, [{"axe": "service", "cible_id": 1, "valeur": None}]).status_code == 200
    assert nb_periodes(db) == 0
