from sqlalchemy import select

from app.models.auth import AuditEvent
from tests import test_rapports_api as rapports

API, DRH = rapports.API, rapports.DRH
charge = rapports.charge  # fixture partagée (période 2026-01 chargée)

P = f"{API}/parametrage"


def _rub(c, libelle):
    return next(r["id"] for r in c.get(P).json()["rubriques"] if r["libelle"] == libelle)


def test_lecture_et_droits(charge, make_client):
    d = charge.get(P).json()
    assert {x["cle"] for x in d["parametres"]} == {"jours_ouvres", "budget_employe"}
    assert d["regles"] and any(r["moteur"] for r in d["rubriques"])
    assert make_client(DRH).post(f"{P}/parametres", json={
        "cle": "jours_ouvres", "valeur": "21", "date_debut": "2027-01-01"}).status_code == 403


def test_parametre_cree_audite_et_immuable(charge, db):
    body = {"cle": "jours_ouvres", "valeur": "21,5", "date_debut": "2026-06-01"}
    r = charge.post(f"{P}/parametres", json=body)
    assert r.status_code == 201 and r.json()["valeur"] == "21.500"
    assert charge.post(f"{P}/parametres", json=body).status_code == 409  # pas de modification
    assert db.scalars(select(AuditEvent).where(AuditEvent.entite == "parametre")).one()
    for mauvais in ({"cle": "x", "valeur": "1"}, {"cle": "jours_ouvres", "valeur": "40"},
                    {"cle": "jours_ouvres", "valeur": "abc"}, {"cle": "budget_employe",
                                                               "valeur": "-1"}):
        assert charge.post(f"{P}/parametres", json={**mauvais, "date_debut": "2027-01-01"}
                           ).status_code == 422


def test_parametre_passe_autorise(charge, db):
    """Pas de clôture : une valeur datée dans le passé s'applique, le journal la trace."""
    assert charge.post(f"{P}/parametres", json={
        "cle": "jours_ouvres", "valeur": "20", "date_debut": "2026-01-01"}).status_code == 201
    assert db.scalars(select(AuditEvent).where(AuditEvent.entite == "parametre")).one()


def test_regle_fin_puis_nouvelle(charge, db):
    rub = _rub(charge, "Brut Réel")
    # règle identique déjà active : refus
    existante = next(r for r in charge.get(P).json()["regles"] if r["date_fin"] is None)
    dup = {"rubrique_id": existante["rubrique_id"], "regle": existante["regle"],
           "date_debut": "2027-01-01"}
    assert charge.post(f"{P}/regles", json=dup).status_code == 409
    fin = charge.post(f"{P}/regles/{existante['id']}/fin", json={"date_fin": "2026-12-31"})
    assert fin.status_code == 200 and fin.json()["date_fin"] == "2026-12-31"
    assert charge.post(f"{P}/regles/{existante['id']}/fin", json={"date_fin": "2027-01-31"}
                       ).status_code == 409  # une règle terminée n'est plus modifiable
    assert charge.post(f"{P}/regles", json=dup).status_code == 201
    assert charge.post(f"{P}/regles", json={**dup, "regle": "n/a"}).status_code == 422
    assert charge.post(f"{P}/regles", json={**dup, "rubrique_id": 9999}).status_code == 404
    assert rub  # la rubrique de base existe


def test_rubriques(charge, db):
    r = charge.post(f"{P}/rubriques", json={"libelle": "Prime X", "unite": "FCFA"})
    assert r.status_code == 201 and r.json()["actif"] is True
    assert charge.post(f"{P}/rubriques", json={"libelle": "Prime X", "unite": "FCFA"}
                       ).status_code == 409
    assert charge.post(f"{P}/rubriques", json={"libelle": "Y", "unite": "kg"}).status_code == 422
    rid = r.json()["id"]
    assert charge.put(f"{P}/rubriques/{rid}", json={"ordre": 99}).json()["ordre"] == 99
    moteur = _rub(charge, "Absences (nb)")
    assert charge.put(f"{P}/rubriques/{moteur}", json={"actif": False}).status_code == 409
    assert charge.put(f"{P}/rubriques/{rid}", json={"actif": False}).json()["actif"] is False
    assert charge.put(f"{P}/rubriques/9999", json={"ordre": 1}).status_code == 404
