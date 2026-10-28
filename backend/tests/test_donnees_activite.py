"""Données d'activité : rubriques de nature « activité », référence reporting, droit marge."""

from decimal import Decimal as D
from io import BytesIO

from openpyxl import load_workbook
from sqlalchemy import delete, select

from app.imports.regles import ATTRIBUTS, REFERENCE_COLONNE
from app.kpi.moteur import (
    CA_INDIVIDUEL,
    CLIENTS,
    MARGE_INDIVIDUELLE,
    PRODUCTIVITE,
    RUBRIQUES_ACTIVITE,
    VENTES,
)
from app.models.auth import Utilisateur, UtilisateurPermission
from app.models.donnees import Periode, SituationMensuelle
from app.models.referentiel import Rubrique, Service
from app.referentiels_init import RUBRIQUES
from tests.test_donnees_api import ADMIN, API, BR, XLSX
from tests.test_import_regles import xlsx
from tests.test_rapports_api import get

PAIE = [r for r, _ in RUBRIQUES]
ENTETES_ACT = ATTRIBUTS + PAIE + [VENTES, CLIENTS, PRODUCTIVITE, CA_INDIVIDUEL,
                                  MARGE_INDIVIDUELLE, REFERENCE_COLONNE]


def lig(entetes=ENTETES_ACT, **kw):
    base = {"ANNÉE": 2026, "MOIS": "Janvier", "MATRICULE": "E1", "Noms": "Ann", "Poste": "P",
            "Type Contrat": "CDI", "Activité": "Front office", "Site": "Douala",
            "Service": "SAV PL"}
    base.update(kw)
    return [base.get(e) for e in entetes]


def envoyer(c, lignes, entetes=ENTETES_ACT):
    lot = c.post(f"{API}/imports",
                 files={"fichier": ("a.xlsx", xlsx(lignes, entetes), XLSX)}).json()
    lot["anomalies"] = c.get(f"{API}/imports/{lot['id']}/anomalies").json()
    return lot


def sans_entete_inconnu(lot):
    return not {a["code"] for a in lot["anomalies"]} & {"ENTETE_INCONNU", "ENTETE_MANQUANT"}


def charger(c, lignes, entetes=ENTETES_ACT):
    lot = envoyer(c, lignes, entetes)
    assert lot["statut"] == "pret", lot
    assert c.post(f"{API}/imports/{lot['id']}/valider").status_code == 200


def codes(lot):
    return {(a["colonne"], a["code"]) for a in lot["anomalies"]}


def test_rubriques_d_activite_semees(db):
    rubs = {r.libelle: r for r in db.scalars(select(Rubrique))}
    assert {lib for lib, _ in RUBRIQUES_ACTIVITE} == {VENTES, CLIENTS, PRODUCTIVITE, CA_INDIVIDUEL,
                                       MARGE_INDIVIDUELLE}
    for lib, _ in RUBRIQUES_ACTIVITE:
        assert rubs[lib].nature == "activite"
    assert rubs[VENTES].unite == "nombre" and rubs[CLIENTS].unite == "nombre"
    assert rubs[PRODUCTIVITE].unite == "nombre"
    assert rubs[CA_INDIVIDUEL].unite == "FCFA" and rubs[MARGE_INDIVIDUELLE].unite == "FCFA"
    paie = [r for r in rubs.values() if r.nature == "paie"]
    assert len(paie) == len(PAIE)
    assert min(rubs[x].ordre for x, _ in RUBRIQUES_ACTIVITE) > max(r.ordre for r in paie)


def test_services_productifs(db):
    prod = {s.libelle for s in db.scalars(select(Service)) if s.productif}
    assert prod == {"SAV PL", "SAV Engins"}


def test_import_avec_colonnes_d_activite_et_reference(make_client):
    c = make_client(ADMIN)
    charger_act = [lig(**{BR: 1000, VENTES: 12, CLIENTS: 7, PRODUCTIVITE: "0.85",
                          CA_INDIVIDUEL: "250000.5", MARGE_INDIVIDUELLE: 40000,
                          REFERENCE_COLONNE: "  Dossier   A12 "})]
    lot = envoyer(c, charger_act)
    assert lot["statut"] == "pret", lot
    assert c.post(f"{API}/imports/{lot['id']}/valider").status_code == 200
    d = c.get(f"{API}/donnees", params={"annee": 2026, "mois": 1}).json()["lignes"][0]
    assert d["montants"][BR] == "1000.000" and VENTES not in d["montants"]
    assert d["indicateurs"][VENTES] == "12.000" and d["indicateurs"][CLIENTS] == "7.000"
    assert d["indicateurs"][PRODUCTIVITE] == "0.850"
    assert d["indicateurs"][CA_INDIVIDUEL] == "250000.500"
    assert d["indicateurs"][MARGE_INDIVIDUELLE] == "40000.000"
    assert d["reference"] == "Dossier A12"
    assert d["total"] == "1000.000"


def test_alias_reference_annick(make_client, db):
    c = make_client(ADMIN)
    entetes = ATTRIBUTS + PAIE + ["Référence Annick"]
    lot = envoyer(c, [lig(entetes, **{BR: 10, "Référence Annick": "R1"})], entetes)
    assert lot["statut"] == "pret" and sans_entete_inconnu(lot), lot
    assert c.post(f"{API}/imports/{lot['id']}/valider").status_code == 200
    assert db.scalar(select(SituationMensuelle.reference_activite)) == "R1"


def test_reference_trop_longue_bloquante(make_client):
    c = make_client(ADMIN)
    lot = envoyer(c, [lig(**{BR: 10, REFERENCE_COLONNE: "x" * 201})])
    assert lot["statut"] != "pret" and lot["nb_bloquants"] == 1
    assert (REFERENCE_COLONNE, "TEXTE_TROP_LONG") in codes(lot)


def test_ancien_fichier_sans_colonnes_d_activite(make_client):
    c = make_client(ADMIN)
    entetes = ATTRIBUTS + PAIE
    lot = envoyer(c, [lig(entetes, **{BR: 1000})], entetes)
    assert lot["statut"] == "pret" and sans_entete_inconnu(lot), lot
    assert c.post(f"{API}/imports/{lot['id']}/valider").status_code == 200
    d = c.get(f"{API}/donnees", params={"annee": 2026, "mois": 1}).json()["lignes"][0]
    assert d["montants"][BR] == "1000.000" and d["total"] == "1000.000"
    assert not d["indicateurs"] and not d["reference"]


def test_ligne_avec_seulement_de_l_activite(make_client):
    c = make_client(ADMIN)
    lot = envoyer(c, [lig(**{VENTES: 3})])
    assert lot["statut"] == "pret", lot
    assert "LIGNE_SANS_MONTANT" not in {a["code"] for a in lot["anomalies"]}
    # témoin : sans aucune valeur, la ligne reste signalée
    vide = envoyer(c, [lig()])
    assert "LIGNE_SANS_MONTANT" in {a["code"] for a in vide["anomalies"]}


def test_valeur_non_numerique_dans_nombre_de_ventes(make_client):
    c = make_client(ADMIN)
    lot = envoyer(c, [lig(**{BR: 10, VENTES: "beaucoup"})])
    assert lot["statut"] != "pret" and lot["nb_bloquants"] >= 1
    assert any(a["colonne"] == VENTES and a["gravite"] == "bloquant" for a in lot["anomalies"]), lot


def test_total_de_paie_inchange_par_les_colonnes_d_activite(make_client):
    c = make_client(ADMIN)
    entetes = ATTRIBUTS + PAIE
    base = [lig(entetes, **{BR: 1000, "Bonus": 50}),
            lig(entetes, MATRICULE="E2", Noms="Bob", **{BR: 2000})]
    charger(c, base, entetes)
    avant = (get(c, "mensuel", annee=2026, mois=1).json(),
             get(c, "annuel", annee=2026, mois=1).json(),
             c.get(f"{API}/donnees/tableau", params={"annee": 2026, "mois": 1}).json())
    riche = [lig(**{BR: 1000, "Bonus": 50, VENTES: 9, CLIENTS: 4, PRODUCTIVITE: 2,
                    CA_INDIVIDUEL: 900000, MARGE_INDIVIDUELLE: 90000, REFERENCE_COLONNE: "R"}),
             lig(MATRICULE="E2", Noms="Bob", **{BR: 2000, VENTES: 1, CA_INDIVIDUEL: 5000})]
    charger(c, riche)
    apres = (get(c, "mensuel", annee=2026, mois=1).json(),
             get(c, "annuel", annee=2026, mois=1).json(),
             c.get(f"{API}/donnees/tableau", params={"annee": 2026, "mois": 1}).json())
    def sans_activite(x):
        if isinstance(x, dict):
            return {k: sans_activite(v) for k, v in x.items() if k != "activite"}
        return [sans_activite(v) for v in x] if isinstance(x, list) else x

    for i in (0, 1):  # le bloc activité apparaît, tout le reste est identique
        assert apres[i]["activite"] is not None
        assert sans_activite(apres[i]) == sans_activite(avant[i])
    t_avant = {x["matricule"]: x["total"] for x in avant[2]["lignes"]}
    t_apres = {x["matricule"]: x["total"] for x in apres[2]["lignes"]}
    assert t_apres == t_avant and D(t_apres["E1"]) == D("1050")


def _sans_marge(db):
    uid = db.scalar(select(Utilisateur.id).where(Utilisateur.email == ADMIN))
    db.execute(delete(UtilisateurPermission).where(
        UtilisateurPermission.utilisateur_id == uid, UtilisateurPermission.permission == "marge"))
    db.commit()


def test_ca_et_marge_individuels_masques_sans_droit_marge(make_client, db):
    c = make_client(ADMIN)
    charger(c, [lig(**{BR: 1000, VENTES: 2, CA_INDIVIDUEL: 5000, MARGE_INDIVIDUELLE: 800})])
    p = {"annee": 2026, "mois": 1}

    d = c.get(f"{API}/donnees", params=p).json()
    assert d["lignes"][0]["indicateurs"][CA_INDIVIDUEL] == "5000.000"
    t = c.get(f"{API}/donnees/tableau", params=p).json()
    libs = {x["libelle"] for x in t["colonnes_activite"]}
    assert {CA_INDIVIDUEL, MARGE_INDIVIDUELLE, VENTES} <= libs
    assert CA_INDIVIDUEL in t["lignes"][0]["indicateurs"]

    _sans_marge(db)
    d = c.get(f"{API}/donnees", params=p).json()
    ind = d["lignes"][0]["indicateurs"]
    assert ind[VENTES] == "2.000"
    assert CA_INDIVIDUEL not in ind and MARGE_INDIVIDUELLE not in ind
    t = c.get(f"{API}/donnees/tableau", params=p).json()
    libs = {x["libelle"] for x in t["colonnes_activite"]}
    assert VENTES in libs and CA_INDIVIDUEL not in libs and MARGE_INDIVIDUELLE not in libs
    assert CA_INDIVIDUEL not in t["lignes"][0]["indicateurs"]
    r = c.get(f"{API}/donnees/modele.xlsx", params={**p, "matricules": ["E1"]})
    en = [x.value for x in load_workbook(BytesIO(r.content))["DONNEES"][3]]
    assert VENTES in en and CA_INDIVIDUEL not in en and MARGE_INDIVIDUELLE not in en


def test_budget_refuse_sur_une_rubrique_d_activite(make_client, db):
    c = make_client(ADMIN)
    charger(c, [lig(**{BR: 1000, VENTES: 2})])
    pid = db.scalar(select(Periode.id).where(Periode.annee == 2026, Periode.mois == 1))
    rid = db.scalar(select(Rubrique.id).where(Rubrique.libelle == CA_INDIVIDUEL))
    r = c.put(f"{API}/budgets/{pid}", json={"lignes": [
        {"axe": "rubrique", "cible_id": rid, "valeur": "10"}]})
    assert r.status_code == 422


def test_parametrage_rubrique_d_activite(make_client, db):
    c = make_client(ADMIN)
    P = f"{API}/parametrage"
    r = c.post(f"{P}/rubriques", json={"libelle": "Nb visites", "unite": "nombre",
                                       "nature": "activite"})
    assert r.status_code == 201 and r.json()["nature"] == "activite"
    assert c.post(f"{P}/rubriques", json={"libelle": "Nb X", "unite": "nombre"}).status_code == 422
    assert c.post(f"{P}/rubriques", json={"libelle": "Nb Y", "unite": "nombre",
                                          "nature": "autre"}).status_code == 422
    nature = {x["libelle"]: x["nature"] for x in c.get(P).json()["rubriques"]}
    assert nature[BR] == "paie" and nature[VENTES] == "activite"
    rid = db.scalar(select(Rubrique.id).where(Rubrique.libelle == VENTES))
    r = c.post(f"{P}/regles", json={"rubrique_id": rid, "regle": "exclu_total_ligne",
                                    "date_debut": "2026-01-01"})
    assert r.status_code == 422
    r = c.put(f"{P}/colonnes", json={"colonnes": [{"rubrique": VENTES, "exclu": True}]})
    assert r.status_code == 422


def _ligne_donnees(c, mat="E1"):
    d = c.get(f"{API}/donnees", params={"annee": 2026, "mois": 1}).json()["lignes"]
    return next(x for x in d if x["matricule"] == mat)


def test_colonne_absente_du_fichier_conserve_les_valeurs_existantes(make_client):
    c = make_client(ADMIN)
    charger(c, [lig(**{BR: 1000, VENTES: 12, CLIENTS: 7, CA_INDIVIDUEL: 5000,
                       REFERENCE_COLONNE: "Dossier A"})])
    # fichier de paie seul : la paie est remplacée, l'activité et la référence restent
    entetes = ATTRIBUTS + PAIE
    charger(c, [lig(entetes, **{BR: 2000})], entetes)
    x = _ligne_donnees(c)
    assert x["montants"][BR] == "2000.000" and x["total"] == "2000.000"
    assert x["indicateurs"][VENTES] == "12.000" and x["indicateurs"][CLIENTS] == "7.000"
    assert x["indicateurs"][CA_INDIVIDUEL] == "5000.000" and x["reference"] == "Dossier A"

    # colonne présente et cellule vide : effacement, les autres colonnes d'activité restent
    entetes = ATTRIBUTS + PAIE + [VENTES]
    charger(c, [lig(entetes, **{BR: 2100})], entetes)
    x = _ligne_donnees(c)
    assert VENTES not in x["indicateurs"] and x["indicateurs"][CLIENTS] == "7.000"
    assert x["reference"] == "Dossier A"

    # référence présente mais vide : effacée
    entetes = ATTRIBUTS + PAIE + [REFERENCE_COLONNE]
    charger(c, [lig(entetes, **{BR: 2200})], entetes)
    x = _ligne_donnees(c)
    assert not x["reference"] and x["indicateurs"][CLIENTS] == "7.000"


def test_apercu_et_annulation_avec_colonnes_absentes(make_client):
    c = make_client(ADMIN)
    charger(c, [lig(**{BR: 1000, VENTES: 12, REFERENCE_COLONNE: "Dossier A"})])
    entetes = ATTRIBUTS + PAIE
    lot = envoyer(c, [lig(entetes, **{BR: 3000})], entetes)
    ap = c.get(f"{API}/imports/{lot['id']}/apercu").json()
    cols = {x["colonne"] for x in ap["lignes"][0]["changements"]}
    assert BR in cols and VENTES not in cols and REFERENCE_COLONNE not in cols
    assert c.post(f"{API}/imports/{lot['id']}/valider").status_code == 200
    assert _ligne_donnees(c)["indicateurs"][VENTES] == "12.000"
    # l'annulation restaure l'état d'avant, activité et référence comprises
    assert c.post(f"{API}/imports/{lot['id']}/annuler").status_code == 200
    x = _ligne_donnees(c)
    assert x["montants"][BR] == "1000.000" and x["indicateurs"][VENTES] == "12.000"
    assert x["reference"] == "Dossier A"


def test_reenregistrement_sans_droit_marge_conserve_ca_et_marge(make_client, db):
    c = make_client(ADMIN)
    charger(c, [lig(**{BR: 1000, VENTES: 2, CA_INDIVIDUEL: 5000, MARGE_INDIVIDUELLE: 800,
                       REFERENCE_COLONNE: "R"})])
    _sans_marge(db)
    corps = {"annee": 2026, "mois": 1, "matricule": "E1", "nom": "Ann", "poste": "P",
             "type_contrat": "CDI", "activite": "Front office", "site": "Douala",
             "service": "SAV PL", "reference": "R",
             "montants": {BR: "1500", VENTES: "3", CA_INDIVIDUEL: "1", MARGE_INDIVIDUELLE: "1"}}
    assert c.post(f"{API}/donnees/lignes", json=corps).status_code == 201
    # le droit marge revenu : les valeurs d'origine sont intactes (envoi ignoré)
    db.add(UtilisateurPermission(
        utilisateur_id=db.scalar(select(Utilisateur.id).where(Utilisateur.email == ADMIN)),
        permission="marge"))
    db.commit()
    x = _ligne_donnees(c)
    assert x["montants"][BR] == "1500.000" and x["indicateurs"][VENTES] == "3.000"
    assert x["indicateurs"][CA_INDIVIDUEL] == "5000.000"
    assert x["indicateurs"][MARGE_INDIVIDUELLE] == "800.000"
