"""Dossier de paie : liste des fichiers, analyse automatique ou à la demande, confinement, API."""

from contextlib import nullcontext

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.core.config import settings
from app.imports import dossier, service
from app.models.auth import AuditEvent, Utilisateur
from app.models.imports import LotImport
from tests.identites import courriel
from tests.test_import_paie import csv_bytes, employe, poser_poste

API = "/api/v1/imports/dossier"
ADMIN, DRH = courriel("admin"), courriel("drh")


@pytest.fixture()
def paie(tmp_path, monkeypatch, db):
    """Dossier de paie temporaire, poste connu, attente de stabilité supprimée."""
    d = tmp_path / "paie"
    d.mkdir()
    monkeypatch.setattr(settings, "IMPORT_DIR", str(d))
    monkeypatch.setattr(dossier, "DELAI_STABILITE", 0)
    poser_poste(db)
    return d


def deposer(d, nom="BrutFinal1026.csv", **kw):
    (d / nom).write_bytes(csv_bytes([employe(**kw)]))
    return nom


def etats(db):
    return {f["nom"]: f["etat"] for f in dossier.lister(db)}


def admin_id(db):
    return db.scalar(select(Utilisateur.id).order_by(Utilisateur.id))


def test_lister_etats_et_fichiers_ignores(paie, db):
    deposer(paie, "BrutFinal1026.csv")
    deposer(paie, "brutfinal0926.CSV", Matricule="E002")
    deposer(paie, "export.csv", Matricule="E003")
    for ignore in ("~$BrutFinal1026.csv", ".cache.csv", "note.txt", "BrutFinal1126.csv.part", "x.tmp"):
        (paie / ignore).write_bytes(b"x")
    (paie / "archive.csv").mkdir()  # un dossier nommé .csv n'est pas un fichier
    sous = paie / "sous"
    sous.mkdir()
    (sous / "BrutFinal0826.csv").write_bytes(b"x")
    assert etats(db) == {"BrutFinal1026.csv": "a_traiter", "brutfinal0926.CSV": "a_traiter",
                         "export.csv": "mois_introuvable"}
    lot = dossier.traiter(db, "brutfinal0926.CSV")
    assert lot is not None and etats(db)["brutfinal0926.CSV"] == "en_verification"
    f = next(x for x in dossier.lister(db) if x["nom"] == "brutfinal0926.CSV")
    assert (f["lot_id"], f["annee"], f["mois"]) == (lot.id, 2026, 9)
    assert f["taille"] > 0 and f["modifie_le"]
    service.valider_lot(db, admin_id(db), lot.id)
    assert etats(db)["brutfinal0926.CSV"] == "importe"


def test_lister_dossier_non_configure(db, monkeypatch):
    monkeypatch.setattr(settings, "IMPORT_DIR", "")
    assert dossier.lister(db) == [] and dossier.lister_possible() is False
    monkeypatch.setattr(settings, "IMPORT_DIR", "/dossier/qui/n/existe/pas")
    assert dossier.lister(db) == [] and dossier.lister_possible() is False


def test_traiter_auto_cree_un_lot_du_dossier_une_seule_fois(paie, db):
    deposer(paie)
    lot = dossier.traiter(db, "BrutFinal1026.csv")
    assert lot.origine == "dossier" and lot.chemin == "BrutFinal1026.csv"
    assert lot.statut == "pret" and lot.cree_par is None and lot.nb_lignes == 1
    assert service.lot_dict(lot)["origine"] == "dossier"
    audit = db.scalar(select(AuditEvent).where(AuditEvent.action == "import_analyse"))
    assert audit.utilisateur_id is None and audit.apres["origine"] == "dossier"
    # second passage : le fichier est déjà en vérification, rien n'est recréé
    assert dossier.traiter(db, "BrutFinal1026.csv") is None
    assert dossier.passage(dossier=paie) == 0
    assert len(list(db.scalars(select(LotImport)))) == 1
    assert db.scalar(select(LotImport.id).where(LotImport.statut == "annule")) is None


def test_passage_traite_tous_les_fichiers_a_traiter(paie, db):
    deposer(paie, "BrutFinal1026.csv")
    deposer(paie, "BrutFinal1126.csv", Matricule="E002")
    deposer(paie, "sans-mois.csv", Matricule="E003")
    assert dossier.passage(dossier=paie) == 2
    assert dossier.passage(dossier=paie) == 0
    assert etats(db) == {"BrutFinal1026.csv": "en_verification", "BrutFinal1126.csv": "en_verification",
                         "sans-mois.csv": "mois_introuvable"}


def test_fichier_deja_valide_ignore_en_auto_et_409_en_manuel(paie, db):
    deposer(paie)
    lot = dossier.traiter(db, "BrutFinal1026.csv")
    lot_id = lot.id
    service.valider_lot(db, admin_id(db), lot_id)
    assert dossier.traiter(db, "BrutFinal1026.csv") is None
    with pytest.raises(HTTPException) as e:
        dossier.traiter(db, "BrutFinal1026.csv", auto=False)
    assert e.value.status_code == 409 and e.value.detail["lot_id"] == lot_id


def test_lot_annule_non_repris_tout_seul(paie, db):
    deposer(paie)
    lot = dossier.traiter(db, "BrutFinal1026.csv")
    lot.statut = "annule"
    db.commit()
    assert etats(db) == {"BrutFinal1026.csv": "annule"}
    assert dossier.passage(dossier=paie) == 0
    assert dossier.traiter(db, "BrutFinal1026.csv", auto=False) is not None  # à la demande de l'admin


def test_mois_introuvable_ignore_en_auto_et_choisi_en_manuel(paie, db):
    deposer(paie, "export.csv")
    uid = admin_id(db)
    assert dossier.traiter(db, "export.csv") is None
    assert db.scalar(select(LotImport.id)) is None
    with pytest.raises(HTTPException) as e:
        dossier.traiter(db, "export.csv", auto=False)
    assert e.value.status_code == 422 and "Mois du fichier introuvable" in e.value.detail
    lot = dossier.traiter(db, "export.csv", annee=2026, mois=7, auto=False, user_id=uid)
    assert lot.origine == "dossier" and lot.chemin == "export.csv" and lot.cree_par == uid
    assert db.scalar(select(AuditEvent.utilisateur_id).where(AuditEvent.action == "import_analyse")) == uid
    assert etats(db) == {"export.csv": "en_verification"}


def test_fichier_en_cours_d_ecriture_repris_plus_tard(paie, db, monkeypatch):
    deposer(paie)
    fichier = paie / "BrutFinal1026.csv"
    monkeypatch.setattr(dossier.time, "sleep", lambda _s: fichier.write_bytes(fichier.read_bytes() + b"\r\n"))
    assert dossier.traiter(db, "BrutFinal1026.csv") is None
    assert dossier.traiter(db, "BrutFinal1026.csv", auto=False) is None
    assert db.scalar(select(LotImport.id)) is None
    monkeypatch.setattr(dossier.time, "sleep", lambda _s: None)
    assert dossier.traiter(db, "BrutFinal1026.csv") is not None


def test_fichier_illisible_en_auto_ne_plante_pas(paie, db):
    (paie / "BrutFinal1026.csv").write_bytes(b"Matricule;Nom\r\nE1;X\r\n")
    assert dossier.traiter(db, "BrutFinal1026.csv") is None
    with pytest.raises(HTTPException) as e:
        dossier.traiter(db, "BrutFinal1026.csv", auto=False)
    assert e.value.status_code == 422
    assert db.scalar(select(LotImport.id)) is None


@pytest.mark.parametrize("nom", ["../secret.csv", "..", "sous/BrutFinal1026.csv", "a\\b.csv", "C:\\x.csv",
                                 "", "absent.csv", "BrutFinal1026.txt"])
def test_chemin_confine_au_dossier(paie, db, tmp_path, nom):
    deposer(tmp_path, "secret.csv")
    deposer(paie, "BrutFinal1026.txt")
    for auto in (True, False):
        with pytest.raises(HTTPException) as e:
            dossier.traiter(db, nom, auto=auto)
        assert e.value.status_code == 404
    with pytest.raises(HTTPException):
        dossier.traiter(db, str(tmp_path / "secret.csv"))


def test_lien_sortant_du_dossier_refuse(paie, db, tmp_path):
    deposer(tmp_path, "dehors.csv")
    try:
        (paie / "lien.csv").symlink_to(tmp_path / "dehors.csv")
    except OSError:
        pytest.skip("liens symboliques non autorisés ici")
    assert dossier.lister(db) == []
    with pytest.raises(HTTPException) as e:
        dossier.traiter(db, "lien.csv")
    assert e.value.status_code == 404


# ---- API ----
def test_api_liste_sans_chemin_du_dossier(paie, db, make_client):
    deposer(paie)
    deposer(paie, "export.csv", Matricule="E002")
    r = make_client(ADMIN).get(API)
    assert r.status_code == 200
    assert str(paie) not in r.text
    corps = r.json()
    assert corps["actif"] is True
    assert {f["nom"]: f["etat"] for f in corps["fichiers"]} == {
        "BrutFinal1026.csv": "a_traiter", "export.csv": "mois_introuvable"}


def test_api_dossier_non_configure(db, make_client, monkeypatch):
    monkeypatch.setattr(settings, "IMPORT_DIR", "")
    assert make_client(ADMIN).get(API).json() == {"actif": False, "fichiers": []}


def test_api_analyser_avec_mois_puis_erreurs(paie, db, make_client):
    deposer(paie, "export.csv")
    c = make_client(ADMIN)
    r = c.post(f"{API}/export.csv")
    assert r.status_code == 422 and "Mois du fichier introuvable" in r.text
    r = c.post(f"{API}/export.csv", params={"annee": 2026, "mois": 7})
    assert r.status_code == 201, r.text
    lot = r.json()
    assert lot["origine"] == "dossier" and lot["statut"] == "pret"
    assert db.get(LotImport, lot["id"]).cree_par is not None
    assert {f["nom"]: (f["etat"], f["lot_id"]) for f in c.get(API).json()["fichiers"]} == {
        "export.csv": ("en_verification", lot["id"])}
    # validé, le fichier ne se réimporte pas
    assert c.post(f"/api/v1/imports/{lot['id']}/valider").json()["statut"] == "valide"
    r = c.post(f"{API}/export.csv", params={"annee": 2026, "mois": 7})
    assert r.status_code == 409 and r.json()["detail"]["lot_id"] == lot["id"]
    assert c.post(f"{API}/export.csv", params={"annee": 2026, "mois": 13}).status_code == 422


def test_api_nom_hors_dossier_ou_inconnu_404(paie, db, make_client, tmp_path):
    deposer(tmp_path, "secret.csv")
    c = make_client(ADMIN)
    assert c.post(f"{API}/..%2Fsecret.csv").status_code == 404
    assert c.post(f"{API}/%2E%2E%2Fsecret.csv").status_code == 404
    assert c.post(f"{API}/absent.csv").status_code == 404


def test_api_reservee_aux_administrateurs(paie, db, make_client):
    deposer(paie)
    d = make_client(DRH)
    assert d.get(API).status_code == 403
    assert d.post(f"{API}/BrutFinal1026.csv").status_code == 403
    assert make_client().get(API).status_code == 401
    assert db.scalar(select(LotImport.id)) is None


def test_envoi_manuel_garde_l_origine_manuel(db, make_client):
    poser_poste(db)
    r = make_client(ADMIN).post("/api/v1/imports", files={
        "fichier": ("BrutFinal1026.csv", csv_bytes([employe()]), "text/csv")})
    assert r.status_code == 201 and r.json()["origine"] == "manuel"


# ---- surveillance ----
def test_demarrer_et_arreter_sur_dossier_vide(paie):
    try:
        assert dossier.demarrer(lambda: nullcontext(None), paie) is True
        assert dossier.demarrer(lambda: nullcontext(None), paie) is True  # déjà lancée
    finally:
        dossier.arreter()
    dossier.arreter()  # sans effet quand rien ne tourne


def test_demarrer_sans_dossier_ne_lance_rien(db, monkeypatch, caplog):
    monkeypatch.setattr(settings, "IMPORT_DIR", "")
    with caplog.at_level("WARNING", logger="app.imports.dossier"):
        assert dossier.demarrer() is False
    assert "IMPORT_DIR" in caplog.text


def test_fichier_modifie_avant_validation_remplace_le_lot_en_attente(paie, db):
    deposer(paie, **{"Emploi occupé": "Technicien"})
    ancien = dossier.traiter(db, "BrutFinal1026.csv")
    assert ancien.statut == "rejete"
    service.ajouter_referentiel(db, admin_id(db), ancien.id, "poste", "Technicien", activite="Front office")
    # le fichier change avant validation : le poste ajouté est toujours cité, il est repris
    deposer(paie, Matricule="E002", **{"Emploi occupé": "Technicien"})
    nouveau = dossier.traiter(db, "BrutFinal1026.csv")
    db.refresh(ancien)
    assert ancien.statut == "annule" and nouveau.statut == "pret"
    assert "Technicien" in nouveau.feuille["ajouts"]["poste"]
    trace = db.scalar(select(AuditEvent).where(AuditEvent.action == "import_abandonne"))
    assert trace.entite_id == str(ancien.id) and trace.apres["remplace_par"] == nouveau.id
    assert db.scalar(select(func.count()).select_from(LotImport).where(
        LotImport.statut.in_(("pret", "rejete")))) == 1


def test_fichier_modifie_sans_la_valeur_ajoutee_ne_la_reprend_pas(paie, db):
    deposer(paie, **{"Emploi occupé": "Technicien"})
    ancien = dossier.traiter(db, "BrutFinal1026.csv")
    service.ajouter_referentiel(db, admin_id(db), ancien.id, "poste", "Technicien", activite="Front office")
    deposer(paie, Matricule="E002")
    nouveau = dossier.traiter(db, "BrutFinal1026.csv")
    db.refresh(ancien)
    assert ancien.statut == "annule" and nouveau.statut == "pret"
    assert not (nouveau.feuille or {}).get("ajouts")
