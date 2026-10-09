from tests.test_donnees_api import ADMIN, API, BR, DRH, charger
from tests.test_import_regles import ligne

ATTRS = {"poste": "P", "type_contrat": "CDI", "activite": "Front office", "site": "Douala",
         "service": "SAV PL"}


def saisie(matricule, nom="A B", **montants):
    return {"matricule": matricule, "nom": nom, **ATTRS, "montants": montants}


def lot(c, lignes, mois=1, brouillon="brouillon-1"):
    return c.post(f"{API}/donnees/lots", json={"annee": 2026, "mois": mois, "brouillon_id": brouillon,
                                               "lignes": lignes})


def test_droits(make_client):
    c = make_client(DRH)
    assert c.get(f"{API}/donnees/preparation", params={"annee": 2026, "mois": 1}).status_code == 403
    assert c.get(f"{API}/donnees/derniere-periode").status_code == 403
    assert c.post(f"{API}/donnees/verifier", json={"annee": 2026, "mois": 1, "lignes": []}).status_code == 403
    assert lot(c, [saisie("E1")]).status_code == 403


def test_preparation_reprend_attributs_et_statuts(make_client):
    c = make_client(ADMIN)
    assert c.get(f"{API}/donnees/derniere-periode").json() is None
    charger(c, [ligne(MATRICULE="E1", Noms="Ann", Site="Douala", **{BR: 1000}),
                ligne(MATRICULE="E2", Noms="Bob", **{BR: 500}),
                ligne(MATRICULE="E2", Noms="Bob", MOIS="Février", **{BR: 600})])
    assert c.get(f"{API}/donnees/derniere-periode").json() == {"annee": 2026, "mois": 2, "lignes": 1}
    d = c.get(f"{API}/donnees/preparation", params={"annee": 2026, "mois": 2}).json()
    par = {s["matricule"]: s for s in d["salaries"]}
    assert par["E1"]["saisi"] is False and par["E1"]["present_precedent"] is True
    assert par["E1"]["attributs"]["site"] == "Douala" and par["E1"]["montants"] == {}
    assert par["E2"]["saisi"] is True and par["E2"]["montants"][BR] == "600.000"
    assert "SAV PL" in d["referentiels"]["service"] and d["rubriques"][0]["libelle"]


def test_verifier_n_ecrit_rien_et_calcule_le_total(make_client):
    c = make_client(ADMIN)
    corps = {"annee": 2026, "mois": 3, "lignes": [
        saisie("E1", **{BR: "1 000,5"}), saisie("E2", **{BR: "abc"}), saisie("", nom="")]}
    r = c.post(f"{API}/donnees/verifier", json=corps).json()
    assert r["totaux"][0]["total"] == "1000.500"
    codes = {(a["ligne"], a["colonne"], a["code"]) for a in r["anomalies"]}
    assert (1, BR, "NON_NUMERIQUE") in codes and (2, "MATRICULE", "VALEUR_MANQUANTE") in codes
    assert not any(code == "TEXTE_CONVERTI" for *_, code in codes)  # la grille ne saisit que du texte
    assert all(a["ligne"] >= 0 for a in r["anomalies"])
    # Aucun salarié ni lot créé par la vérification.
    assert c.get(f"{API}/donnees/preparation", params={"annee": 2026, "mois": 3}).json()["salaries"] == []


def test_lot_idempotent_apercu_et_choix_par_ligne(make_client):
    c = make_client(ADMIN)
    charger(c, [ligne(MATRICULE="E1", Noms="Ann", **{BR: 1000}),
                ligne(MATRICULE="E2", Noms="Bob", **{BR: 500})])
    lignes = [saisie("E1", "Ann", **{BR: "1200"}), saisie("E2", "Bob", **{BR: "500"}),
              saisie("E3", "Cid", **{BR: "0.125"})]
    r = lot(c, lignes)
    assert r.status_code == 201 and r.json()["statut"] == "pret"
    lot_id = r.json()["id"]
    assert lot(c, lignes).json()["id"] == lot_id  # double clic : même lot

    ap = c.get(f"{API}/imports/{lot_id}/apercu").json()
    assert (ap["nouvelle"], ap["modifiee"], ap["identique"]) == (1, 1, 1)
    e1 = next(x for x in ap["lignes"] if x["matricule"] == "E1")
    assert e1["statut"] == "modifiee" and e1["total_avant"] == "1000.000" and e1["total_apres"] == "1200.000"

    # E1 gardé tel quel : seule la nouvelle ligne et l'identique passent.
    v = c.post(f"{API}/imports/{lot_id}/valider",
               json={"garder": [{"annee": 2026, "mois": 1, "matricule": "e1"}]})
    assert v.status_code == 200
    d = {x["matricule"]: x for x in c.get(f"{API}/donnees", params={"annee": 2026, "mois": 1}).json()["lignes"]}
    assert d["E1"]["montants"][BR] == "1000.000" and d["E3"]["montants"][BR] == "0.125"
    assert lot(c, lignes).status_code == 409

    assert c.post(f"{API}/imports/{lot_id}/annuler").status_code == 200
    d = {x["matricule"]: x for x in c.get(f"{API}/donnees", params={"annee": 2026, "mois": 1}).json()["lignes"]}
    assert set(d) == {"E1", "E2"} and d["E1"]["montants"][BR] == "1000.000"


def test_lot_tout_garde(make_client):
    c = make_client(ADMIN)
    charger(c, [ligne(MATRICULE="E1", Noms="Ann", **{BR: 1000})])
    lot_id = lot(c, [saisie("E1", "Ann", **{BR: "9"})], brouillon="brouillon-2").json()["id"]
    v = c.post(f"{API}/imports/{lot_id}/valider",
               json={"garder": [{"annee": 2026, "mois": 1, "matricule": "E1"}]})
    assert v.status_code == 200
    d = c.get(f"{API}/donnees", params={"annee": 2026, "mois": 1}).json()["lignes"]
    assert d[0]["montants"][BR] == "1000.000"


def test_absents_ignore_les_employes_deja_saisis_pour_le_mois(make_client):
    c = make_client(ADMIN)
    charger(c, [ligne(MATRICULE="E1", Noms="Ann", **{BR: 1000}),
                ligne(MATRICULE="E2", Noms="Bob", **{BR: 500}),
                ligne(MATRICULE="E3", Noms="Cid", **{BR: 700}),
                ligne(MATRICULE="E2", Noms="Bob", MOIS="Février", **{BR: 600})])
    # Correction partielle de février : E2 déjà saisi n'est pas « absent », E3 l'est.
    lot_id = lot(c, [saisie("E1", "Ann", **{BR: "1100"})], mois=2, brouillon="brouillon-3").json()["id"]
    ap = c.get(f"{API}/imports/{lot_id}/apercu").json()
    assert [a["matricule"] for a in ap["absents"]] == ["E3"] and ap["nb_absents"] == 1


def test_modele_filtre_par_matricules(make_client):
    import io

    from openpyxl import load_workbook
    c = make_client(ADMIN)
    charger(c, [ligne(MATRICULE="E1", Noms="Ann"), ligne(MATRICULE="E2", Noms="Bob")])
    r = c.get(f"{API}/donnees/modele.xlsx", params={"annee": 2026, "mois": 2, "matricules": ["e2"]})
    ws = load_workbook(io.BytesIO(r.content))["DONNEES"]
    mats = [row[2] for row in ws.iter_rows(min_row=4, values_only=True) if row[2]]
    assert mats == ["E2"]


def test_modele_suit_la_selection_et_la_saisie(make_client):
    import io
    from decimal import Decimal

    from openpyxl import load_workbook
    c = make_client(ADMIN)
    assert make_client(DRH).post(f"{API}/donnees/modele.xlsx",
                                 json={"annee": 2026, "mois": 2, "lignes": []}).status_code == 403

    def feuille(lignes):
        r = c.post(f"{API}/donnees/modele.xlsx", json={"annee": 2026, "mois": 2, "lignes": lignes})
        assert r.status_code == 200
        ws = load_workbook(io.BytesIO(r.content))["DONNEES"]
        return [row for row in ws.iter_rows(min_row=4, values_only=True) if any(row)]

    # Personne de coché : modèle vide (en-tête seulement).
    assert feuille([]) == []
    rangs = feuille([saisie("E2", "Bob", **{BR: "1 000,5"}), saisie("SM-0001", "Sans Mat")])
    entete = [x.value for x in load_workbook(io.BytesIO(c.post(
        f"{API}/donnees/modele.xlsx", json={"annee": 2026, "mois": 2, "lignes": []}).content))["DONNEES"][3]]
    br = entete.index(BR)
    assert [r[2] for r in rangs] == ["E2", None] and [r[3] for r in rangs] == ["Bob", "Sans Mat"]
    assert rangs[0][8] == "SAV PL" and Decimal(str(rangs[0][br])) == Decimal("1000.5")
