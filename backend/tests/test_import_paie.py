"""Import direct de l'export de paie (CSV) : lecture, activité par le poste, correspondance, API."""

from decimal import Decimal

import pytest
from sqlalchemy import select

from app.imports.lecture import FichierIllisible
from app.imports.paie import lire_csv, mois_du_nom
from app.imports.regles import valider
from app.models.donnees import SituationMensuelle
from app.models.referentiel import Activite, CorrespondancePaie, Poste, Rubrique
from app.referentiels_init import CORRESPONDANCE_PAIE
from tests.identites import courriel
from tests.test_import_regles import refs

API = "/api/v1"
ADMIN, DRH = courriel("admin"), courriel("drh")
ENTETE = ["Matricule", "Nom", "Prénom", "Intitulé établissement", "Nature du contrat", "Emploi occupé",
          "Intitulé service", "Intitulé département", "SALAIRE DE BASE", "BRUT", "CNPS PAT", "AT PAT",
          "BONUS", "RETENUE CREDIT DIVERS", "RETENUE CREDIT DIVERS", "NET A PAYER"]
RUBRIQUES = [lib for lib, _ in refs().rubriques]
LIENS = {c.casefold(): lib for lib, cols in CORRESPONDANCE_PAIE.items() for c in cols}


def employe(**kw):
    base = {"Matricule": "E001", "Nom": "DUPONT", "Prénom": "Léa", "Intitulé établissement": "Douala",
            "Nature du contrat": "CDI", "Emploi occupé": "Conseiller", "Intitulé service": "SAV PL",
            "Intitulé département": "Atelier", "SALAIRE DE BASE": "100 000", "BRUT": "150 000,50",
            "CNPS PAT": "1000", "AT PAT": "", "BONUS": "", "RETENUE CREDIT DIVERS": "5",
            "NET A PAYER": "120000"}
    base.update(kw)
    return [base.get(h, "") for h in ENTETE]


def csv_bytes(lignes, entete=ENTETE, encodage="latin-1") -> bytes:
    texte = "\r\n".join(";".join(cellules) for cellules in [entete, *lignes]) + "\r\n"
    return texte.encode(encodage)


def lire(lignes, **kw):
    return lire_csv(csv_bytes(lignes, **kw), RUBRIQUES, LIENS, 2026, 10)


@pytest.mark.parametrize("nom, attendu", [
    ("BrutFinal1026.CSV", (2026, 10)), ("brutfinal0125.csv", (2025, 1)),
    ("C:\\dossier\\BrutFinal1226.csv", (2026, 12)), ("a/BrutFinal0326 (1).csv", (2026, 3)),
    ("BrutFinal1326.csv", None), ("BrutFinal0026.csv", None), ("paie.csv", None),
    ("BrutFinal102.csv", None), ("BrutFinal10265.csv", None), ("", None), (None, None),
])
def test_mois_du_nom(nom, attendu):
    assert mois_du_nom(nom) == attendu


def test_conversion_somme_decimale_sans_arrondi():
    f = lire([employe(**{"SALAIRE DE BASE": "1 234,567", "AT PAT": "0,1"})])
    col = {h: i for i, h in enumerate(f.entetes)}
    num, row = f.lignes[0]
    assert num == 2
    assert row[col["MATRICULE"]] == "E001" and row[col["Noms"]] == "DUPONT Léa"
    assert (row[col["ANNÉE"]], row[col["MOIS"]]) == (2026, "Octobre")
    assert (row[col["Poste"]], row[col["Type Contrat"]], row[col["Site"]], row[col["Service"]]) == (
        "Conseiller", "CDI", "Douala", "SAV PL")
    assert row[col["Activité"]] is None
    assert row[col["Brut Réel"]] == Decimal("150000.50")
    assert row[col["Salaire brut garantie"]] == Decimal("1234.567")
    assert row[col["Charges Patronales"]] == Decimal("1000.1")  # CNPS PAT + AT PAT (vide = 0)
    assert row[col["Bonus"]] is None  # toutes colonnes vides : pas de montant
    assert row[col["Commission"]] is None  # aucune colonne de paie présente
    assert all(isinstance(row[col[r]], Decimal | None) for r in RUBRIQUES)


def test_separateur_de_milliers_insecable():
    f = lire([employe(BRUT="1\u00a0250\u00a0000")])
    assert f.lignes[0][1][f.entetes.index("Brut Réel")] == Decimal(1250000)


def test_latin1_et_utf8():
    for enc in ("latin-1", "utf-8", "utf-8-sig"):
        f = lire([employe()], encodage=enc)
        assert f.lignes[0][1][f.entetes.index("Noms")] == "DUPONT Léa"


def test_colonnes_ignorees_et_doublons_sans_probleme():
    f = lire([employe()])
    assert f.entetes == ["ANNÉE", "MOIS", "MATRICULE", "Noms", "Poste", "Type Contrat", "Activité",
                         "Site", "Service", *RUBRIQUES]
    assert not any("RETENUE" in str(h) or "NET" in str(h) or "département" in str(h) for h in f.entetes)


def test_colonne_mappee_en_double_comptee_une_fois():
    entete = [*ENTETE, "BRUT"]
    ligne = [*employe(), "999"]
    f = lire_csv(csv_bytes([ligne], entete), RUBRIQUES, LIENS, 2026, 10)
    assert f.lignes[0][1][f.entetes.index("Brut Réel")] == Decimal("150000.50")


def test_lignes_vides_sautees_et_numeros_de_ligne():
    f = lire([employe(), [""] * len(ENTETE), employe(Matricule="E002")])
    assert [n for n, _ in f.lignes] == [2, 4]


def test_texte_non_numerique_garde_pour_le_controle():
    f = lire([employe(BRUT="beaucoup")])
    _, anos, _ = valider(f, refs(postes={"conseiller"}, postes_activite={"conseiller": "Front office"}))
    assert [(a.ligne, a.colonne, a.code) for a in anos if a.code == "NON_NUMERIQUE"] == [
        (2, "Brut Réel", "NON_NUMERIQUE")]


def test_pas_un_export_de_paie():
    with pytest.raises(FichierIllisible, match="Emploi occupé"):
        lire_csv(b"Matricule;Nom\r\nE1;X\r\n", RUBRIQUES, LIENS, 2026, 10)
    with pytest.raises(FichierIllisible):
        lire_csv(b"", RUBRIQUES, LIENS, 2026, 10)


# ---- contrôles : activité par le poste ----
def controler(lignes, **kw):
    f = lire(lignes)
    return valider(f, refs(**kw))


def test_activite_deduite_du_poste():
    L, anos, _ = controler([employe()], postes={"conseiller"}, postes_activite={"conseiller": "Back Office"})
    assert L[0].activite == "Back Office"
    assert not [a for a in anos if a.gravite == "bloquant"], anos
    assert not [a for a in anos if a.code in ("ENTETE_MANQUANT", "COLONNE_INCONNUE")]


def test_poste_sans_activite_bloque_la_ligne_seulement():
    L, anos, _ = controler([employe(), employe(Matricule="E002", **{"Emploi occupé": "Chef"})],
                           postes={"conseiller", "chef"},
                           postes_activite={"conseiller": "Front office", "chef": None})
    bloquants = [(a.ligne, a.colonne, a.code, a.valeur) for a in anos if a.gravite == "bloquant"]
    assert bloquants == [(3, "Poste", "POSTE_SANS_ACTIVITE", "Chef")]
    assert next(x for x in L if x.matricule == "E001").activite == "Front office"


def test_poste_inconnu_signale_une_fois_comme_sans_activite():
    _, anos, _ = controler([employe(), employe(Matricule="E002")], postes=set(), postes_activite={})
    codes = [(a.code, a.gravite) for a in anos if a.colonne == "Poste"]
    assert codes == [("POSTE_SANS_ACTIVITE", "bloquant")]


def test_excel_avec_activite_remplie_inchange():
    from tests.test_import_regles import ligne, run
    L, ens, _, _ = run([ligne()], postes={"p"}, postes_activite={"p": "Back Office"})
    assert L[0].activite == "Front office"  # la colonne remplie prime
    assert not [e for e in ens if e[2] in ("POSTE_SANS_ACTIVITE", "ENTETE_MANQUANT")]


# ---- API ----
def poser_poste(db, libelle="Conseiller", activite="Front office"):
    aid = db.scalar(select(Activite.id).where(Activite.libelle == activite)) if activite else None
    p = Poste(libelle=libelle, activite_id=aid)
    db.add(p)
    db.commit()
    return p.id


def envoyer(c, lignes, nom="BrutFinal1026.CSV", **params):
    return c.post(f"{API}/imports", params=params,
                  files={"fichier": (nom, csv_bytes(lignes), "text/csv")})


def test_csv_de_bout_en_bout(make_client, db):
    poser_poste(db)
    c = make_client(ADMIN)
    r = envoyer(c, [employe(), employe(Matricule="E002", Nom="MARTIN", Prénom="Paul")])
    assert r.status_code == 201, r.text
    lot = r.json()
    assert lot["statut"] == "pret" and lot["nb_lignes"] == 2 and lot["nb_bloquants"] == 0
    assert c.post(f"{API}/imports/{lot['id']}/valider").json()["statut"] == "valide"
    db.expire_all()
    sits = list(db.scalars(select(SituationMensuelle)))
    assert len(sits) == 2
    assert {db.get(Activite, s.activite_id).libelle for s in sits} == {"Front office"}
    assert {s.poste_id for s in sits} != {None}
    from app.models.donnees import Montant, Periode
    per = db.get(Periode, sits[0].periode_id)
    assert (per.annee, per.mois) == (2026, 10)
    brut = db.scalar(select(Montant.valeur).join(Rubrique, Rubrique.id == Montant.rubrique_id)
                     .where(Montant.situation_id == sits[0].id, Rubrique.libelle == "Brut Réel"))
    assert brut == Decimal("150000.50")


def test_csv_mois_absent_du_nom(make_client, db):
    poser_poste(db)
    c = make_client(ADMIN)
    r = envoyer(c, [employe()], nom="paie.csv")
    assert r.status_code == 422 and "mois" in r.json()["detail"].lower()
    r = envoyer(c, [employe()], nom="paie.csv", annee=2026, mois=9)
    assert r.status_code == 201 and r.json()["statut"] == "pret"
    assert envoyer(c, [employe()], nom="paie2.csv", annee=2026, mois=13).status_code == 422


def test_csv_illisible_422(make_client):
    c = make_client(ADMIN)
    r = c.post(f"{API}/imports", files={"fichier": ("BrutFinal1026.csv", b"a;b\r\n1;2\r\n", "text/csv")})
    assert r.status_code == 422 and "export de paie" in r.json()["detail"]


def test_csv_reserve_aux_administrateurs(make_client):
    assert envoyer(make_client(DRH), [employe()]).status_code == 403


def test_poste_sans_activite_resolu_depuis_l_import(make_client, db):
    pid = poser_poste(db, activite=None)
    c = make_client(ADMIN)
    lot = envoyer(c, [employe()]).json()
    assert lot["statut"] == "rejete"
    anos = c.get(f"{API}/imports/{lot['id']}/anomalies?gravite=bloquant").json()
    assert [(a["colonne"], a["code"], a["valeur"]) for a in anos] == [
        ("Poste", "POSTE_SANS_ACTIVITE", "Conseiller")]
    assert anos[0]["proposition"]["dimension"] == "poste" and anos[0]["proposition"]["lignes"] == [2]
    u = f"{API}/imports/{lot['id']}/referentiels"
    assert c.post(u, json={"dimension": "poste", "valeur": "Conseiller"}).status_code == 409
    assert c.post(u, json={"dimension": "poste", "valeur": "Conseiller", "activite": "Nulle part"}
                  ).status_code == 422
    r = c.post(u, json={"dimension": "poste", "valeur": "Conseiller", "activite": "back office"})
    assert r.status_code == 200 and r.json()["statut"] == "pret"
    assert c.post(f"{API}/imports/{lot['id']}/valider").json()["statut"] == "valide"
    db.expire_all()
    assert db.get(Activite, db.get(Poste, pid).activite_id).libelle == "Back Office"
    assert db.get(Activite, db.scalar(select(SituationMensuelle.activite_id))).libelle == "Back Office"
    # l'activité est ensuite connue : un poste classé ne peut plus être « ajouté »
    nouveau = envoyer(c, [employe(Matricule="E009")], nom="BrutFinal1126.csv").json()
    assert nouveau["statut"] == "pret"


def test_poste_nouveau_cree_avec_son_activite(make_client, db):
    c = make_client(ADMIN)
    lot = envoyer(c, [employe(**{"Emploi occupé": "Magasinier"})]).json()
    assert lot["statut"] == "rejete"
    r = c.post(f"{API}/imports/{lot['id']}/decisions", json={"ajouts": [
        {"dimension": "poste", "valeur": "Magasinier", "activite": "Back Office"}]})
    assert r.status_code == 200 and r.json()["statut"] == "pret", r.text
    assert c.post(f"{API}/imports/{lot['id']}/valider").json()["statut"] == "valide"
    db.expire_all()
    p = db.scalar(select(Poste).where(Poste.libelle == "Magasinier"))
    assert db.get(Activite, p.activite_id).libelle == "Back Office"


def test_activite_du_poste_modifiable_dans_les_listes(make_client, db):
    pid = poser_poste(db, activite=None)
    c = make_client(ADMIN)
    liste = c.get(f"{API}/referentiels/poste").json()["valeurs"]
    assert liste == [{"id": pid, "libelle": "Conseiller", "actif": True, "activite_id": None}]
    aid = db.scalar(select(Activite.id).where(Activite.libelle == "Front office"))
    r = c.put(f"{API}/referentiels/poste/{pid}", json={"activite_id": aid})
    assert r.status_code == 200 and r.json()["activite_id"] == aid
    assert c.put(f"{API}/referentiels/poste/{pid}", json={"activite_id": 9999}).status_code == 422
    assert c.put(f"{API}/referentiels/poste/{pid}", json={"actif": False}).json()["activite_id"] == aid
    assert c.put(f"{API}/referentiels/poste/{pid}", json={"activite_id": None}).json()["activite_id"] is None
    assert c.put(f"{API}/referentiels/service/1", json={"activite_id": aid}).status_code == 422
    assert make_client(DRH).put(f"{API}/referentiels/poste/{pid}", json={"activite_id": aid}
                                ).status_code == 403


# ---- correspondance de la paie ----
def test_correspondance_remplie_par_defaut(make_client, db):
    c = make_client(ADMIN)
    lignes = c.get(f"{API}/parametrage/correspondance-paie").json()
    par_rubrique = {}
    for x in lignes:
        par_rubrique.setdefault(x["rubrique"], []).append(x["colonne"])
    assert sorted(par_rubrique["Charges Patronales"]) == sorted(CORRESPONDANCE_PAIE["Charges Patronales"])
    assert par_rubrique["Brut Réel"] == ["BRUT"]


def test_correspondance_crud_admin(make_client, db):
    c = make_client(ADMIN)
    u = f"{API}/parametrage/correspondance-paie"
    rub = {r.libelle: r.id for r in db.scalars(select(Rubrique))}
    r = c.post(u, json={"colonne": "  PRIME   TRANSPORT ", "rubrique_id": rub["Bonus"]})
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    assert r.json()["colonne"] == "PRIME TRANSPORT" and r.json()["rubrique"] == "Bonus"
    assert db.get(CorrespondancePaie, cid).colonne_norm == "prime transport"
    # doublon (casse et espaces ignorés), rubrique inconnue ou d'activité, colonne vide
    assert c.post(u, json={"colonne": "prime transport", "rubrique_id": rub["Bonus"]}).status_code == 409
    assert c.post(u, json={"colonne": "X", "rubrique_id": 99999}).status_code == 422
    activite = db.scalar(select(Rubrique.id).where(Rubrique.nature != "paie"))
    assert c.post(u, json={"colonne": "X", "rubrique_id": activite}).status_code == 422
    assert c.post(u, json={"colonne": "  ", "rubrique_id": rub["Bonus"]}).status_code == 422
    # modification, y compris vers une colonne déjà prise
    r = c.put(f"{u}/{cid}", json={"colonne": "PRIME TRANSPORT", "rubrique_id": rub["Commission"]})
    assert r.status_code == 200 and r.json()["rubrique"] == "Commission"
    assert c.put(f"{u}/{cid}", json={"colonne": "BRUT", "rubrique_id": rub["Bonus"]}).status_code == 409
    assert c.put(f"{u}/99999", json={"colonne": "Z", "rubrique_id": rub["Bonus"]}).status_code == 404
    assert any(x["id"] == cid for x in c.get(u).json())
    assert c.delete(f"{u}/{cid}").status_code == 204
    assert c.delete(f"{u}/{cid}").status_code == 404
    assert db.get(CorrespondancePaie, cid) is None


def test_correspondance_reservee_aux_administrateurs(make_client, db):
    u = f"{API}/parametrage/correspondance-paie"
    d = make_client(DRH)
    assert d.get(u).status_code == 403
    assert d.post(u, json={"colonne": "X", "rubrique_id": 1}).status_code == 403
    assert d.put(f"{u}/1", json={"colonne": "X", "rubrique_id": 1}).status_code == 403
    assert d.delete(f"{u}/1").status_code == 403
    assert make_client().get(u).status_code == 401


def test_correspondance_modifiee_change_l_import(make_client, db):
    poser_poste(db)
    c = make_client(ADMIN)
    u = f"{API}/parametrage/correspondance-paie"
    rub = {r.libelle: r.id for r in db.scalars(select(Rubrique))}
    c.post(u, json={"colonne": "NET A PAYER", "rubrique_id": rub["Formation"]})
    lot = envoyer(c, [employe()]).json()
    assert lot["statut"] == "pret"
    assert c.post(f"{API}/imports/{lot['id']}/valider").status_code == 200
    from app.models.donnees import Montant
    v = db.scalar(select(Montant.valeur).join(Rubrique, Rubrique.id == Montant.rubrique_id)
                  .where(Rubrique.libelle == "Formation"))
    assert v == Decimal(120000)
