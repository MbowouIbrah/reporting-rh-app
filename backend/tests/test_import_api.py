import pytest
from sqlalchemy import func, select

from app.models.auth import AuditEvent
from app.models.donnees import Montant, Periode, SituationMensuelle
from app.models.referentiel import Rubrique
from tests.test_import_regles import ligne, xlsx

API = "/api/v1"
ADMIN, DRH, EQUIP, VN = ("admin@exemple.invalid", "drh@exemple.invalid", "dps.equipment@exemple.invalid",
                         "dir.commercial.vn@exemple.invalid")
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def up(client, lignes, nom="f.xlsx"):
    return client.post(f"{API}/imports", files={"fichier": (nom, xlsx(lignes), XLSX)})


def fichier_a():
    return [ligne(Formation=100, Bonus=5), ligne(MATRICULE="EMP002", Noms="C D", Formation=200)]


def fichier_b():  # même clés que A, montants différents
    return [ligne(Formation=999), ligne(MATRICULE="EMP002", Noms="C D", Formation=888),
            ligne(MATRICULE="EMP003", Noms="E F")]


def etat(db):
    db.expire_all()
    rub = {r.id: r.libelle for r in db.scalars(select(Rubrique))}
    rows = db.execute(select(SituationMensuelle.periode_id, SituationMensuelle.salarie_id,
                             Montant.rubrique_id, Montant.valeur)
                      .join(Montant, Montant.situation_id == SituationMensuelle.id)).all()
    return sorted((p, s, rub[r], float(v)) for p, s, r, v in rows)


def nb_sit(db):
    db.expire_all()
    return db.scalar(select(func.count()).select_from(SituationMensuelle))


@pytest.mark.parametrize("who", [DRH, EQUIP, VN])
def test_lecteurs_403_sur_imports_et_periodes(make_client, who):
    c = make_client(who)
    assert c.get(f"{API}/imports").status_code == 403
    assert c.get(f"{API}/imports/1").status_code == 403
    assert c.get(f"{API}/periodes").status_code == 403
    assert up(c, fichier_a()).status_code == 403
    for path in ("/imports/1/valider", "/imports/1/annuler", "/periodes/1/cloturer"):
        assert c.post(f"{API}{path}").status_code == 403
    assert c.post(f"{API}/periodes/1/rouvrir", json={"motif": "test motif"}).status_code == 403
    assert c.post(f"{API}/referentiels/site/alias", json={"alias": "x", "cible_id": 1}
                  ).status_code == 403


def test_anonyme_401(make_client):
    c = make_client()
    assert c.get(f"{API}/imports").status_code == 401
    assert up(c, fichier_a()).status_code == 401


def test_cycle_import_valide_et_idempotent(make_client, db):
    c = make_client(ADMIN)
    r = up(c, fichier_a())
    assert r.status_code == 201 and r.json()["statut"] == "pret", r.text
    lot = r.json()
    assert nb_sit(db) == 0  # rien n'est écrit avant validation explicite
    assert c.post(f"{API}/imports/{lot['id']}/valider").json()["statut"] == "valide"
    assert nb_sit(db) == 2 and len(etat(db)) == 3
    # même fichier : refusé, état inchangé
    again = up(c, fichier_a())
    assert again.status_code == 409 and again.json()["detail"]["lot_id"] == lot["id"]
    assert nb_sit(db) == 2 and len(etat(db)) == 3
    assert c.post(f"{API}/imports/{lot['id']}/valider").status_code == 409


def test_fichier_pret_renvoye_tel_quel(make_client):
    c = make_client(ADMIN)
    a, b = up(c, fichier_a()).json(), up(c, fichier_a()).json()
    assert a["id"] == b["id"]


def test_lot_rejete_non_validable_et_anomalies_localisees(make_client, db):
    c = make_client(ADMIN)
    lot = up(c, [ligne(Service="Inconnu")]).json()
    assert lot["statut"] == "rejete" and lot["nb_bloquants"] == 1
    anos = c.get(f"{API}/imports/{lot['id']}/anomalies?gravite=bloquant").json()
    assert [(a["ligne"], a["colonne"], a["code"]) for a in anos] == [
        (2, "Service", "REFERENTIEL_INCONNU")]
    assert c.get(f"{API}/imports/{lot['id']}/rapport.xlsx").status_code == 200
    assert c.post(f"{API}/imports/{lot['id']}/valider").status_code == 409
    assert nb_sit(db) == 0


def test_fichier_illisible_422(make_client):
    c = make_client(ADMIN)
    r = c.post(f"{API}/imports", files={"fichier": ("x.xlsx", b"pas un xlsx", XLSX)})
    assert r.status_code == 422


def test_remplacement_par_cle_et_annulation_restaure(make_client, db):
    c = make_client(ADMIN)
    a = up(c, fichier_a()).json()
    c.post(f"{API}/imports/{a['id']}/valider")
    avant = etat(db)
    b = up(c, fichier_b()).json()
    assert b["statut"] == "pret"
    c.post(f"{API}/imports/{b['id']}/valider")
    assert nb_sit(db) == 3  # EMP001/EMP002 remplacés, EMP003 ajouté : pas de doublon
    assert etat(db) != avant
    # annuler A alors que B l'a remplacé : refusé
    assert c.post(f"{API}/imports/{a['id']}/annuler").status_code == 409
    assert c.post(f"{API}/imports/{b['id']}/annuler").json()["statut"] == "annule"
    assert nb_sit(db) == 2 and etat(db) == avant
    # puis A peut être annulé, et le même fichier redevient importable
    assert c.post(f"{API}/imports/{a['id']}/annuler").status_code == 200
    assert nb_sit(db) == 0
    assert up(c, fichier_a()).status_code == 201


def test_annuler_lot_pret(make_client):
    c = make_client(ADMIN)
    lot = up(c, fichier_a()).json()
    assert c.post(f"{API}/imports/{lot['id']}/annuler").json()["statut"] == "annule"
    assert c.post(f"{API}/imports/{lot['id']}/annuler").status_code == 409


def test_periode_close_refusee_et_reouverture_tracee(make_client, db):
    c = make_client(ADMIN)
    lot = up(c, fichier_a()).json()
    c.post(f"{API}/imports/{lot['id']}/valider")
    pid = c.get(f"{API}/periodes").json()[0]["id"]
    assert c.post(f"{API}/periodes/{pid}/cloturer").json()["statut"] == "close"
    # nouvel import sur la période close : rejeté à l'analyse
    rej = up(c, fichier_b()).json()
    assert rej["statut"] == "rejete"
    codes = {a["code"] for a in c.get(f"{API}/imports/{rej['id']}/anomalies").json()}
    assert "PERIODE_CLOSE" in codes
    # annulation d'un lot validé sur période close : refusée
    assert c.post(f"{API}/imports/{lot['id']}/annuler").status_code == 409
    # réouverture : motif obligatoire, tracée
    assert c.post(f"{API}/periodes/{pid}/rouvrir", json={"motif": "x"}).status_code == 422
    assert c.post(f"{API}/periodes/{pid}/rouvrir", json={"motif": "correction paie"}
                  ).json()["statut"] == "ouverte"
    ev = db.scalars(select(AuditEvent).where(AuditEvent.action == "reouverture")).one()
    assert ev.apres["motif"] == "correction paie"
    assert db.get(Periode, pid).statut == "ouverte"


def test_ecritures_auditees(make_client, db):
    c = make_client(ADMIN)
    lot = up(c, fichier_a()).json()
    c.post(f"{API}/imports/{lot['id']}/valider")
    c.post(f"{API}/imports/{lot['id']}/annuler")
    actions = [e.action for e in db.scalars(select(AuditEvent).where(
        AuditEvent.entite == "lot_import").order_by(AuditEvent.id))]
    assert actions == ["import_analyse", "import_valide", "import_annule"]


def test_alias_referentiel(make_client):
    c = make_client(ADMIN)
    sites = c.get(f"{API}/referentiels/site").json()["valeurs"]
    douala = next(s["id"] for s in sites if s["libelle"] == "Douala")
    assert c.post(f"{API}/referentiels/site/alias", json={"alias": "  DLA ", "cible_id": douala}
                  ).status_code == 201
    assert c.post(f"{API}/referentiels/site/alias", json={"alias": "dla", "cible_id": douala}
                  ).status_code == 409
    lot = up(c, [ligne(Site="dla")]).json()
    assert lot["statut"] == "pret"
    assert c.get(f"{API}/referentiels/inconnu").status_code == 404
