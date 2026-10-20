import pytest
from sqlalchemy import select

from app.models.donnees import SituationMensuelle
from app.models.imports import LotImport
from app.models.referentiel import Site
from tests.test_import_api import ADMIN, API, DRH, XLSX, up, xlsx
from tests.test_import_regles import ligne


def anomalies(c, lot_id):
    return c.get(f"{API}/imports/{lot_id}/anomalies?gravite=bloquant").json()


def test_site_inconnu_ajoute_dans_le_lot_puis_cree_a_la_validation(make_client, db):
    c = make_client(ADMIN)
    lot = up(c, [ligne(Site="Kribi")]).json()
    assert lot["statut"] == "rejete"
    ano = anomalies(c, lot["id"])[0]
    assert ano["code"] == "REFERENTIEL_INCONNU" and ano["proposition"] == {"dimension": "site"}
    r = c.post(f"{API}/imports/{lot['id']}/referentiels",
               json={"dimension": "site", "valeur": "Kribi", "type_site": "agence"})
    assert r.status_code == 200 and r.json()["statut"] == "pret", r.text
    assert db.scalar(select(Site).where(Site.libelle == "Kribi")) is None
    # la valeur ajoutée reste proposée après une autre correction
    u = f"{API}/imports/{lot['id']}/lignes/2"
    assert "Kribi" in c.get(u).json()["choix"]["Site"]
    assert c.put(u, json={"valeurs": {"Poste": "Chef"}}).json()["statut"] == "pret"
    assert c.post(f"{API}/imports/{lot['id']}/valider").json()["statut"] == "valide"
    db.expire_all()
    site = db.scalar(select(Site).where(Site.libelle == "Kribi"))
    assert site is not None and site.type_site == "agence"
    assert db.scalar(select(SituationMensuelle).where(SituationMensuelle.site_id == site.id)) is not None


def test_ajout_referentiel_refus(make_client):
    c = make_client(ADMIN)
    lot = up(c, [ligne(Site="Kribi")]).json()
    u = f"{API}/imports/{lot['id']}/referentiels"
    assert c.post(u, json={"dimension": "site", "valeur": "douala", "type_site": "agence"}).status_code == 409
    assert c.post(u, json={"dimension": "site", "valeur": "Kribi"}).status_code == 422
    assert c.post(u, json={"dimension": "site", "valeur": "Kribi", "type_site": "x"}).status_code == 422
    assert c.post(u, json={"dimension": "poste", "valeur": "Kribi"}).status_code == 422
    assert c.post(u, json={"dimension": "service", "valeur": "  "}).status_code == 422


def test_doublon_propose_les_lignes_et_une_ligne_peut_etre_retiree(make_client):
    c = make_client(ADMIN)
    lot = up(c, [ligne(), ligne(Formation=5)]).json()
    assert lot["statut"] == "rejete"
    ano = anomalies(c, lot["id"])[0]
    assert ano["code"] == "DOUBLON" and ano["proposition"] == {"lignes": [2, 3]}
    assert c.delete(f"{API}/imports/{lot['id']}/lignes/9").status_code == 404
    r = c.delete(f"{API}/imports/{lot['id']}/lignes/3")
    assert r.status_code == 200 and r.json()["statut"] == "pret" and r.json()["nb_lignes"] == 1


def test_valeur_manquante_reprise_du_mois_precedent(make_client):
    c = make_client(ADMIN)
    prec = up(c, [ligne()]).json()
    assert c.post(f"{API}/imports/{prec['id']}/valider").json()["statut"] == "valide"
    lot = up(c, [ligne(MOIS="Février", Service=None)]).json()
    assert lot["statut"] == "rejete"
    ano = anomalies(c, lot["id"])[0]
    assert ano["code"] == "VALEUR_MANQUANTE"
    assert ano["proposition"] == {"valeur": "SAV PL", "periode": "janvier 2026"}
    r = c.put(f"{API}/imports/{lot['id']}/lignes/2", json={"valeurs": {"Service": "SAV PL"}})
    assert r.json()["statut"] == "pret"


def test_site_inconnu_propose_le_site_du_mois_precedent(make_client):
    c = make_client(ADMIN)
    prec = up(c, [ligne()]).json()
    assert c.post(f"{API}/imports/{prec['id']}/valider").json()["statut"] == "valide"
    lot = up(c, [ligne(MOIS="Février", Site="Kribi")]).json()
    ano = anomalies(c, lot["id"])[0]
    assert ano["code"] == "REFERENTIEL_INCONNU"
    assert ano["proposition"]["dimension"] == "site" and ano["proposition"]["periode"] == "janvier 2026"
    assert ano["proposition"]["valeur"]


def test_mutation_propose_la_valeur_enregistree_puis_acceptee(make_client):
    c = make_client(ADMIN)
    prec = up(c, [ligne()]).json()
    assert c.post(f"{API}/imports/{prec['id']}/valider").json()["statut"] == "valide"
    lot = up(c, [ligne(MOIS="Février", Service="Pneumatique")]).json()
    mut = [a for a in c.get(f"{API}/imports/{lot['id']}/anomalies").json() if a["code"] == "MUTATION"]
    assert [(a["ligne"], a["colonne"]) for a in mut] == [(2, "Service")]
    assert mut[0]["proposition"] == {"valeur": "SAV PL", "periode": "janvier 2026"}
    sim = c.post(f"{API}/imports/{lot['id']}/decisions", json={"ignores": ["2|Service"], "simuler": True})
    assert not any(a["code"] == "MUTATION" for a in sim.json()["anomalies"])


def test_mutation_dans_le_fichier_propose_le_mois_precedent_du_fichier(make_client):
    c = make_client(ADMIN)
    lot = up(c, [ligne(), ligne(MOIS="Février", Service="Pneumatique")]).json()
    mut = [a for a in c.get(f"{API}/imports/{lot['id']}/anomalies").json() if a["code"] == "MUTATION"]
    assert [(a["ligne"], a["proposition"]) for a in mut] == [(3, {"valeur": "SAV PL", "periode": "janvier 2026"})]


def test_valeur_manquante_sans_historique_pas_de_proposition(make_client):
    c = make_client(ADMIN)
    lot = up(c, [ligne(Service=None)]).json()
    assert anomalies(c, lot["id"])[0]["proposition"] is None


@pytest.mark.parametrize("methode, chemin, corps", [
    ("post", "referentiels", {"dimension": "service", "valeur": "Achats"}),
    ("delete", "lignes/2", None),
])
def test_lecteur_403(make_client, methode, chemin, corps):
    lot = up(make_client(ADMIN), [ligne(Site="Kribi")]).json()
    c = make_client(DRH)
    r = getattr(c, methode)(f"{API}/imports/{lot['id']}/{chemin}", **({"json": corps} if corps else {}))
    assert r.status_code == 403


def test_decisions_simulees_puis_appliquees_en_une_fois(make_client, db):
    c = make_client(ADMIN)
    lot = up(c, [ligne(Site="Kribi"), ligne(MATRICULE="E2", Poste=None)]).json()
    u = f"{API}/imports/{lot['id']}/decisions"
    corps = {"ajouts": [{"dimension": "site", "valeur": "Kribi"}], "ignores": ["3|Poste"]}
    sim = c.post(u, json={**corps, "simuler": True})
    assert sim.status_code == 200, sim.text
    restants = {(a["ligne"], a["colonne"], a["code"]) for a in sim.json()["anomalies"]}
    assert (2, "Site", "REFERENTIEL_INCONNU") not in restants and (3, "Poste", "VALEUR_MANQUANTE") not in restants
    assert c.get(f"{API}/imports/{lot['id']}").json()["statut"] == "rejete"  # rien écrit
    assert c.post(u, json=corps).status_code == 422  # type du site obligatoire pour enregistrer
    corps["ajouts"][0]["type_site"] = "agence"
    r = c.post(u, json={**corps, "lignes": {"2": {"Poste": "Chef"}}})
    assert r.status_code == 200 and r.json()["statut"] == "pret", r.text
    tous = c.get(f"{API}/imports/{lot['id']}/anomalies").json()
    assert not any(a["ligne"] == 3 and a["colonne"] == "Poste" for a in tous)
    assert c.get(f"{API}/imports/{lot['id']}/lignes/2").json()["brut"]["Poste"] == "Chef"


def test_ligne_de_total_un_seul_point_et_supprimable(make_client):
    c = make_client(ADMIN)
    lot = up(c, [ligne(), ligne(MATRICULE=None, Noms="TOTAL", Poste=None)]).json()
    assert lot["statut"] == "rejete"
    anos = anomalies(c, lot["id"])
    assert [(a["code"], a["ligne"], a["proposition"]) for a in anos] == [("LIGNE_TOTAL", 3, {"lignes": [3]})]
    r = c.delete(f"{API}/imports/{lot['id']}/lignes/3")
    assert r.status_code == 200 and r.json()["statut"] == "pret" and r.json()["nb_lignes"] == 1


@pytest.mark.parametrize("col, vide, attendu", [("MOIS", {"MOIS": None}, "Janvier"), ("ANNÉE", {"ANNÉE": None}, "2026")])
def test_periode_vide_propose_celle_des_autres_lignes(make_client, col, vide, attendu):
    c = make_client(ADMIN)
    lot = up(c, [ligne(), ligne(MATRICULE="EMP002", **vide)]).json()
    ano = next(a for a in anomalies(c, lot["id"]) if a["colonne"] == col)
    assert ano["proposition"] == {"corrections": [
        {"valeur": attendu, "libelle": f"{attendu}, comme les autres lignes du fichier"}]}
    r = c.put(f"{API}/imports/{lot['id']}/lignes/3", json={"valeurs": {col: attendu}})
    assert r.json()["statut"] == "pret", r.text


def test_meme_fichier_sans_modification_repart_de_zero(make_client, db):
    c = make_client(ADMIN)
    ancien = up(c, [ligne(Site="Kribi")]).json()
    r = up(c, [ligne(Site="Kribi")])
    assert r.status_code == 201 and r.json()["id"] != ancien["id"], r.text
    assert db.get(LotImport, ancien["id"]).statut == "annule"


@pytest.mark.parametrize("choix", ["reprendre", "recommencer"])
def test_meme_fichier_avec_modifications_reprise_ou_tout_annuler(make_client, db, choix):
    c = make_client(ADMIN)
    rows = [ligne(Site="Kribi"), ligne(MATRICULE="EMP002", Noms="C D", Site="Kribi")]
    lot = up(c, rows).json()
    u = f"{API}/imports/{lot['id']}/lignes/2"
    assert c.put(u, json={"valeurs": {"Site": "Douala"}}).status_code == 200
    r = up(c, rows)
    assert r.status_code == 409 and r.json()["detail"] | {"message": None} == {
        "message": None, "lot_id": lot["id"], "reprise": True, "modifications": 1}
    r = c.post(f"{API}/imports?reprise={choix}", files={"fichier": ("f.xlsx", xlsx(rows), XLSX)})
    assert r.status_code == 201, r.text
    lignes_ko = {a["ligne"] for a in anomalies(c, r.json()["id"])}
    db.expire_all()
    if choix == "reprendre":
        assert r.json()["id"] == lot["id"] and lignes_ko == {3}  # la correction de la ligne 2 est gardée
    else:
        assert r.json()["id"] != lot["id"] and lignes_ko == {2, 3}
        assert db.get(LotImport, lot["id"]).statut == "annule"
