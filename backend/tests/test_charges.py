"""Répartition des charges : total, axes, effectifs, budgets et liste nominative des personnes."""

from decimal import Decimal as D

import pytest
from sqlalchemy import select

from app.api.rapports import _bloc_activite_charges
from app.kpi import charges as kc
from app.kpi.moteur import VENTES, Budgets, Ligne, Params, PeriodeData, annuel, mensuel
from app.models.auth import AuditEvent, Utilisateur, UtilisateurPermission
from app.models.donnees import Periode
from app.models.pilotage import Budget
from app.models.referentiel import Rubrique, Service, Site
from tests.identites import courriel
from tests.test_activite_restitution import ligne as ligne_act
from tests.test_activite_restitution import objectif as objectif_act
from tests.test_activite_restitution import objectifs_charges
from tests.test_activite_restitution import periode as periode_act
from tests.test_import_regles import ligne, xlsx
from tests.test_kpi_moteur import REFS

API = "/api/v1"
ADMIN, DRH, EQUIP = courriel("admin"), courriel("drh"), courriel("dps.equipment")
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
BR, ABS, CP = "Brut Réel", "Absences (nb)", "Charges Patronales"
JAN = {"du": "2026-01", "au": "2026-01"}
FEV = {"du": "2026-02", "au": "2026-02", "cmp_du": "2026-01", "cmp_au": "2026-01"}


def donnees():
    # Bonus (janvier) et Primes sur ventes (février) sont hors total ; les absences sont des jours.
    jan = [
        ligne(MATRICULE="E1", Noms="Ann", Service="SAV PL",
              **{BR: "1000.5", ABS: 2, CP: 100, "Bonus": 50, "Frais de mission": 30}),
        ligne(MATRICULE="E2", Noms="Bob", Service="Commerce VN", Site="Yaoundé",
              **{"Type Contrat": "CDD", BR: 2000, CP: 200}),
        ligne(MATRICULE="E3", Noms="Cy", Service="Administration", Site="Yaoundé",
              **{BR: 4000, "Primes exceptionnelles": 70}),
    ]
    fev = [
        ligne(MOIS="Février", MATRICULE="E1", Noms="Ann", Service="SAV PL", **{BR: 1100, CP: 110}),
        ligne(MOIS="Février", MATRICULE="E2", Noms="Bob", Service="Commerce VN", Site="Yaoundé",
              **{"Type Contrat": "CDD", BR: 2100, "Primes sur ventes": 999}),
        ligne(MOIS="Février", MATRICULE="E4", Noms="Dee", Service="SAV PL", **{BR: 500}),
    ]
    return jan + fev


@pytest.fixture()
def charge(make_client, db):
    c = make_client(ADMIN)
    lot = c.post(f"{API}/imports", files={"fichier": ("d.xlsx", xlsx(donnees()), XLSX)}).json()
    assert lot["statut"] == "pret", lot
    assert c.post(f"{API}/imports/{lot['id']}/valider").status_code == 200
    return c


def get(c, path, **params):
    return c.get(f"{API}/rapports/{path}", params=params)


def lignes_type(r):
    return {x["libelle"]: x for x in r["axes"]["type"]["lignes"]}


def test_total_egal_total_charges_du_rapport_annuel(charge):
    for periode, attendu in ((JAN, "7400.5"), (FEV, "3810"),
                             ({"du": "2026-01", "au": "2026-02"}, "11210.5")):
        r = get(charge, "charges", **periode).json()
        assert D(r["total"]["m"]) == D(attendu)
        assert sum(D(x["m"]) for x in r["axes"]["type"]["lignes"]) == D(attendu)
        # le même total que le « TOTAL CHARGES » du rapport annuel sur les mêmes mois
        a = get(charge, "annuel", **periode).json()
        tot = next(x for x in a["a_type_charge"] if x["rubrique"] == "TOTAL CHARGES")
        assert D(tot["m"]) == D(r["total"]["m"])
    assert "familles" not in r


def test_montants_par_type_et_comparaison(charge):
    r = get(charge, "charges", **JAN).json()
    assert (r["du"], r["au"], r["cmp_du"], r["cmp_au"]) == ("2026-01", "2026-01", "2025-01",
                                                           "2025-01")
    types = lignes_type(r)
    assert D(types[BR]["m"]) == D("7000.5")
    assert D(types["Primes exceptionnelles"]["m"]) == 70  # le Bonus (hors total) n'y est pas
    assert D(types["Frais de mission"]["m"]) == 30
    assert D(types["Charges Patronales"]["m"]) == 300
    assert types[BR]["m1"] is None and types[BR]["var"] is None
    r = get(charge, "charges", **FEV).json()
    br = lignes_type(r)[BR]
    assert D(br["m"]) == 3700 and D(br["m1"]) == D("7000.5") and D(br["var"]) == D("-3300.5")
    assert D(r["total"]["m1"]) == D("7400.5")
    assert D(r["total"]["var_pct"]) == (D("3810") - D("7400.5")) / D("7400.5")


def test_rubrique_hors_total_absente_des_lignes_et_comptee_a_part(charge):
    jan = get(charge, "charges", **JAN).json()
    assert "Bonus" not in lignes_type(jan)
    assert "Primes exceptionnelles" in lignes_type(jan)
    assert D(jan["hors_total"]["montant"]) == 50
    fev = get(charge, "charges", **FEV).json()
    assert "Primes sur ventes" not in lignes_type(fev)
    assert D(fev["hors_total"]["montant"]) == 999
    # ni les absences ni les rubriques d'activité parmi les types de charge
    assert ABS not in lignes_type(jan) and "Nombre de ventes" not in lignes_type(jan)
    assert {"Charges Patronales", "Frais de mission"} <= set(lignes_type(jan))


def test_effectif_par_type_de_charge(charge):
    jan = lignes_type(get(charge, "charges", **JAN).json())
    assert jan[BR]["effectif"] == 3 and "Salaire brut garantie" not in jan
    fev = lignes_type(get(charge, "charges", **FEV).json())
    assert (fev[BR]["effectif"], fev[BR]["effectif1"]) == (3, 3)
    assert (fev[BR]["entrees"], fev[BR]["sorties"]) == (1, 1)


def test_repartitions_par_site_et_contrat(charge):
    r = get(charge, "charges", **JAN).json()
    assert [(x["libelle"], D(x["m"])) for x in lignes_axe(r, "site")] == [
        ("Yaoundé", D("6270")), ("Douala", D("1130.5"))]
    assert [x["libelle"] for x in lignes_axe(r, "contrat")] == ["CDI", "CDD"]
    for cle in AXES:  # parts : environ 100 %
        assert sum(D(x["part"]) for x in lignes_axe(r, cle)) == pytest.approx(D(1)), cle
    # comparaison par ligne
    r = get(charge, "charges", **FEV).json()
    site = {x["libelle"]: x for x in lignes_axe(r, "site")}
    assert D(site["Yaoundé"]["m"]) == 2100 and D(site["Yaoundé"]["m1"]) == 6270
    assert D(site["Douala"]["m1"]) == D("1130.5")


def test_type_sans_montant_n_a_pas_de_ligne():
    pd = PeriodeData((Ligne(1, "S", "Douala", "Front", "CDI", {"Brut Réel": D(10)}),))
    r = kc.rapport([pd], [], ("Brut Réel", "Bonus"))
    types = r["axes"]["type"]["lignes"]
    assert [x["libelle"] for x in types] == ["Brut Réel"] and types[0]["part"] == 1


def test_exclusion_suit_le_mois():
    """Une rubrique hors total un mois seulement n'entre dans l'axe que l'autre mois."""
    ligne_ = Ligne(1, "S", "Douala", "Front", "CDI", {"Brut Réel": D(10), "Bonus": D(5)})
    compte = PeriodeData((ligne_,))
    hors = PeriodeData((ligne_,), frozenset({"Bonus"}))
    r = kc.rapport([compte, hors], [], ("Brut Réel", "Bonus"))
    par = {x["libelle"]: x for x in r["axes"]["type"]["lignes"]}
    assert par["Bonus"]["m"] == 5  # compté au 1er mois seulement
    assert r["total"]["m"] == sum(x["m"] for x in par.values()) == 25
    assert r["hors_total"] == {"montant": 5, "nb_rubriques": 1}


def test_hors_total_rubriques_distinctes_sur_la_periode(charge):
    """`nb_rubriques` compte chaque rubrique exclue une fois, quel que soit le nombre de mois."""
    ligne_ = Ligne(1, "S", "Douala", "Front", "CDI", {"Brut Réel": D(10), "Bonus": D(5)})
    hors = PeriodeData((ligne_,), frozenset({"Bonus"}))
    r = kc.rapport([hors, hors, hors], [], ("Brut Réel", "Bonus"))
    assert r["hors_total"] == {"montant": 15, "nb_rubriques": 1}
    # deux rubriques exclues sur deux mois différents : Bonus en janvier, Primes sur ventes en février
    deux = get(charge, "charges", **PLAGE2).json()
    assert deux["hors_total"]["nb_rubriques"] == 2 and D(deux["hors_total"]["montant"]) == 1049


def test_charges_periode_invalide_et_sans_donnee(charge):
    assert get(charge, "charges").status_code == 422
    assert get(charge, "charges", du="2026-01").status_code == 422
    assert get(charge, "charges", du="2026-03", au="2026-02").status_code == 422
    assert get(charge, "charges", du="2021-01", au="2026-01").status_code == 422  # 61 mois
    assert get(charge, "charges", du="2025-01", au="2026-02").status_code == 200  # 14 mois
    assert get(charge, "charges", du="2026-01", au="2026-02", cmp_du="2025-01",
               cmp_au="2025-01").status_code == 422
    assert get(charge, "charges", du="2020-01", au="2020-02").status_code == 404


def test_charges_perimetre_et_filtre(charge, make_client):
    equip = get(make_client(EQUIP), "charges", **JAN).json()
    assert D(equip["total"]["m"]) == D("1130.5")  # SAV PL seul : 1000.5 + 100 + 30 (Bonus hors total)
    assert D(lignes_type(equip)[BR]["m"]) == D("1000.5")
    assert get(make_client(EQUIP), "charges", **JAN, service="Administration").status_code == 404
    f = get(charge, "charges", **JAN, service="Commerce VN|Administration").json()
    assert D(f["total"]["m"]) == D("6270")
    assert get(charge, "charges", **JAN, matricule="E2").status_code == 200
    assert get(make_client(EQUIP), "charges", **JAN, matricule="E1").status_code == 403


def pers(c, axe, valeur, **params):
    return get(c, "charges/personnes", axe=axe, valeur=valeur, **params)


def test_personnes_exige_le_droit_nominatif(charge, make_client, db):
    assert pers(make_client(EQUIP), "type", BR, **JAN).status_code == 403
    assert pers(make_client(), "type", BR, **JAN).status_code == 401
    assert db.scalars(select(AuditEvent).where(
        AuditEvent.action == "lecture_charges_personnes")).first() is None


def test_personnes_liste_et_journal(charge, make_client, db):
    r = pers(make_client(DRH), "type", BR, **FEV)
    assert r.status_code == 200
    lignes = r.json()
    assert [x["matricule"] for x in lignes] == ["E2", "E1", "E4", "E3"]
    e1 = lignes[1]
    assert e1["nom"] == "Ann" and e1["service"] == "SAV PL" and e1["site"] == "Douala"
    assert e1["activite"] == "Front office" and e1["contrat"] == "CDI" and e1["poste"] == "P"
    assert D(e1["m"]) == 1100 and D(e1["m1"]) == D("1000.5") and D(e1["var"]) == D("99.5")
    assert (e1["entree"], e1["sortie"]) == (False, False)
    e4, e3 = lignes[2], lignes[3]
    assert D(e4["m1"]) == 0 and D(e3["m"]) == 0 and D(e3["m1"]) == 4000
    assert (e4["entree"], e4["sortie"]) == (True, False)
    assert (e3["entree"], e3["sortie"]) == (False, True)
    # rubrique hors total : rien n'est compté, la liste est vide
    assert pers(make_client(DRH), "type", "Bonus", **JAN).json() == []
    ev = db.scalars(select(AuditEvent).where(
        AuditEvent.action == "lecture_charges_personnes").order_by(AuditEvent.id)).all()
    assert len(ev) == 2 and ev[0].entite == "type" and ev[0].entite_id == BR
    assert ev[0].utilisateur_id is not None and ev[0].apres["du"] == "2026-02"


def test_personnes_par_axe_et_sous_ligne_activite(charge, make_client):
    drh = make_client(DRH)
    site = pers(drh, "site", "Yaoundé", **FEV).json()
    assert [(x["matricule"], D(x["m"]), D(x["m1"])) for x in site] == [
        ("E2", D(2100), D(2200)), ("E3", D(0), D(4070))]
    # le montant d'une ligne de site est le total compté de la personne (Primes sur ventes exclues)
    assert [x["matricule"] for x in pers(drh, "service", "SAV PL", **FEV).json()] == ["E1", "E4"]
    assert [x["matricule"] for x in pers(drh, "contrat", "CDD", **FEV).json()] == ["E2"]
    assert [x["matricule"] for x in pers(drh, "activite", "Front office", **FEV).json()] == [
        "E2", "E1", "E4", "E3"]
    # sous-ligne : l'activité de la ligne
    assert [x["matricule"] for x in pers(drh, "service", "SAV PL", **FEV,
                                         ligne_activite="Front office").json()] == ["E1", "E4"]
    assert pers(drh, "service", "SAV PL", **FEV, ligne_activite="Back Office").json() == []
    # site : la sous-ligne est un service
    assert [x["matricule"] for x in pers(drh, "site", "Yaoundé", **FEV,
                                         ligne_activite="Commerce VN").json()] == ["E2"]
    assert [x["matricule"] for x in pers(drh, "site", "Yaoundé", **FEV,
                                         ligne_activite="Administration").json()] == ["E3"]
    assert pers(drh, "site", "Inconnu", **FEV).json() == []
    # `activite` reste le filtre de la barre
    assert pers(drh, "type", BR, **FEV, activite="Back Office").status_code == 404
    assert [x["matricule"] for x in pers(drh, "type", BR, **FEV, activite="Front office"
                                         ).json()] == ["E2", "E1", "E4", "E3"]


def test_personnes_hors_perimetre_absentes(charge, make_client, db):
    u = db.scalar(select(Utilisateur).where(Utilisateur.email == EQUIP))
    u.permissions.append(UtilisateurPermission(permission="nominatif"))
    db.commit()
    r = pers(make_client(EQUIP), "type", BR, **FEV)
    assert r.status_code == 200
    assert [x["matricule"] for x in r.json()] == ["E1", "E4"]  # SAV PL : ni E2, ni E3
    assert "Bob" not in r.text and "Cy" not in r.text
    assert pers(make_client(EQUIP), "site", "Yaoundé", **FEV).json() == []


def test_personnes_refus(charge, make_client):
    drh = make_client(DRH)
    assert pers(drh, "type", "Inconnue", **JAN).status_code == 422
    assert pers(drh, "type", ABS, **JAN).status_code == 422
    assert pers(drh, "marque", "X", **JAN).status_code == 422  # axe inconnu
    assert get(drh, "charges/personnes", axe="type", **JAN).status_code == 422  # valeur obligatoire
    assert get(drh, "charges/personnes", valeur=BR, **JAN).status_code == 422  # axe obligatoire
    assert pers(drh, "type", BR, du="2026-03", au="2026-02").status_code == 422
    assert pers(drh, "type", BR, du="2020-01", au="2020-01").status_code == 404


def test_personnes_nombre_egal_a_la_liste(charge, make_client):
    """Personnes payées en N, plus les sorties : la longueur de la liste nominative de la
    rubrique comptée dans le total."""
    r = get(charge, "charges", **FEV).json()
    drh = make_client(DRH)
    for x in lignes_axe(r, "type"):
        liste = pers(drh, "type", x["libelle"], **FEV).json()
        assert len(liste) == x["effectif"] + x["sorties"], x["libelle"]


def test_audit_ecrit_meme_si_la_liste_est_vide(charge, make_client, db):
    r = pers(make_client(DRH), "type", "Salaire brut garantie", **JAN)
    assert r.status_code == 200 and r.json() == []
    ev = db.scalars(select(AuditEvent).where(
        AuditEvent.action == "lecture_charges_personnes").order_by(AuditEvent.id)).all()
    assert len(ev) == 1 and ev[0].entite_id == "Salaire brut garantie"


def _cles_et_valeurs(x, cles, valeurs):
    if isinstance(x, dict):
        for k, v in x.items():
            cles.add(k)
            _cles_et_valeurs(v, cles, valeurs)
    elif isinstance(x, list):
        for v in x:
            _cles_et_valeurs(v, cles, valeurs)
    else:
        valeurs.add(x)


def test_charges_sans_droit_nominatif_aucune_identite(charge, make_client):
    r = get(make_client(DRH), "charges", **FEV)
    assert r.status_code == 200
    cles: set = set()
    valeurs: set = set()
    _cles_et_valeurs(r.json(), cles, valeurs)
    assert not cles & {"matricule", "nom", "salarie_id", "salarie"}
    assert not valeurs & {"E1", "E2", "E3", "E4", "Ann", "Bob", "Cy", "Dee"}
    # le rapport lui-même ne donne que des agrégats ; la liste exige le droit nominatif
    equip = make_client(EQUIP)
    cles.clear()
    valeurs.clear()
    _cles_et_valeurs(get(equip, "charges", **FEV).json(), cles, valeurs)
    assert not cles & {"matricule", "nom", "salarie_id", "salarie"}
    assert "Ann" not in valeurs and "E1" not in valeurs


def test_personnes_filtre_departement(charge, make_client):
    drh = make_client(DRH)
    tous = pers(drh, "type", BR, **JAN).json()
    equipment = pers(drh, "type", BR, **JAN, departement="Equipment").json()
    assert [x["matricule"] for x in equipment] == [x["matricule"] for x in tous] != []
    assert pers(drh, "type", BR, **JAN, departement="Winpart").status_code == 404
    assert [x["matricule"] for x in pers(drh, "type", BR, **JAN, service="SAV PL").json()] == [
        "E1"]


def test_rubrique_desactivee_avec_montants_reste_dans_les_types(make_client, db):
    """Le total compte une rubrique désactivée qui a des montants : l'axe type aussi."""
    c = make_client(ADMIN)
    lignes = [ligne(MATRICULE="E1", Noms="Ann", **{BR: 1000, "Formation": 40}),
              ligne(MATRICULE="E2", Noms="Bob", Site="Yaoundé", **{BR: 2000, "Formation": 60})]
    lot = c.post(f"{API}/imports", files={"fichier": ("d.xlsx", xlsx(lignes), XLSX)}).json()
    assert lot["statut"] == "pret", lot
    assert c.post(f"{API}/imports/{lot['id']}/valider").status_code == 200
    db.scalar(select(Rubrique).where(Rubrique.libelle == "Formation")).actif = False
    db.commit()
    r = get(c, "charges", **JAN).json()
    assert sum(D(x["m"]) for x in lignes_axe(r, "type")) == D(r["total"]["m"]) == 3100
    assert D(axe(r, "type", "Formation")["m"]) == 100
    assert axe(r, "type", "Formation")["effectif"] == 2
    liste = pers(c, "type", "Formation", **JAN)
    assert liste.status_code == 200
    assert [(x["matricule"], D(x["m"])) for x in liste.json()] == [("E2", D(60)), ("E1", D(40))]


def test_controles_seulement_pour_un_seul_mois(charge):
    un = get(charge, "charges", **JAN).json()
    assert un["controles"] and not any(x["bloquant"] for x in un["controles"])
    assert {"controle", "ecart", "bloquant"} <= set(un["controles"][0])
    # les mêmes contrôles que le rapport mensuel du même mois
    m = get(charge, "mensuel", annee=2026, mois=1, ref_annee=2025, ref_mois=1).json()
    assert [x["controle"] for x in un["controles"]] == [x["controle"] for x in m["controles"]]
    plage = get(charge, "charges", du="2026-01", au="2026-02").json()
    assert "controles" not in plage


# ---------- axes, effectifs, partiel, budgets, activité ----------

PLAGE2 = {"du": "2026-01", "au": "2026-02"}
AXES = ("type", "site", "service", "activite", "contrat")


def lignes_axe(r, cle):
    return r["axes"][cle]["lignes"]


def axe(r, cle, libelle):
    return next(x for x in lignes_axe(r, cle) if x["libelle"] == libelle)


def test_somme_de_chaque_axe_egale_le_total(charge):
    for periode in (JAN, FEV, PLAGE2):
        r = get(charge, "charges", **periode).json()
        for cle in AXES:
            lignes = lignes_axe(r, cle)
            assert sum(D(x["m"]) for x in lignes) == D(r["total"]["m"]), (periode, cle)
            if r["total"]["m1"] is not None:
                # en février comparé à janvier, les primes se comparent à février 2025 (sans
                # donnée) : les 70 de « Primes exceptionnelles » de janvier n'ont pas de ligne
                ecart = D(70) if cle == "type" and periode is FEV else 0
                assert sum(D(x["m1"]) for x in lignes) == D(r["total"]["m1"]) - ecart, (periode, cle)
            assert sum(D(x["part"]) for x in lignes) == pytest.approx(D(1))
            assert [D(x["m"]) for x in lignes] == sorted((D(x["m"]) for x in lignes), reverse=True) \
                or cle == "type"
            for x in lignes:  # le détail par activité redonne la ligne
                assert sum(D(e["m"]) for e in x.get("enfants", [])) == D(x["m"]) \
                    or "enfants" not in x
    r = get(charge, "charges", **JAN).json()
    assert "enfants" not in lignes_axe(r, "activite")[0]
    assert all("enfants" in x for cle in ("type", "site", "service", "contrat")
               for x in lignes_axe(r, cle))


def test_axes_contenu(charge):
    r = get(charge, "charges", **JAN).json()
    assert [x["libelle"] for x in lignes_axe(r, "site")] == ["Yaoundé", "Douala"]
    assert all(x["type_site"] in ("principal", "agence") for x in lignes_axe(r, "site"))
    yaounde = axe(r, "site", "Yaoundé")
    assert D(yaounde["m"]) == 6270 and yaounde["effectif"] == 2 and yaounde["effectif1"] is None
    # Site détaillé par service (et non par activité).
    assert [(e["libelle"], D(e["m"])) for e in yaounde["enfants"]] == [
        ("Administration", D(4070)), ("Commerce VN", D(2200))]
    assert [x["libelle"] for x in lignes_axe(r, "service")] == [
        "Administration", "Commerce VN", "SAV PL"]
    assert [x["libelle"] for x in lignes_axe(r, "contrat")] == ["CDI", "CDD"]
    # types de charge : rubriques comptées, à plat, dans l'ordre du référentiel
    types = [x["libelle"] for x in lignes_axe(r, "type")]
    assert BR in types and "Bonus" not in types and ABS not in types
    assert D(axe(r, "type", BR)["m"]) == D("7000.5") and axe(r, "type", BR)["effectif"] == 3
    assert axe(r, "type", BR)["m1"] is None and axe(r, "type", BR)["var"] is None
    assert D(r["hors_total"]["montant"]) == 50 and r["hors_total"]["nb_rubriques"] == 1
    fev = get(charge, "charges", **FEV).json()
    assert D(fev["hors_total"]["montant"]) == 999 and fev["hors_total"]["nb_rubriques"] == 1
    # une rubrique à montant nul n'est pas une ligne
    assert "Salaire brut garantie" not in [x["libelle"] for x in lignes_axe(fev, "type")]


def test_effectifs_entrees_sorties(charge):
    r = get(charge, "charges", **FEV).json()
    assert (r["effectif"]["n"], r["effectif"]["n1"], r["effectif"]["var"]) == (3, 3, 0)
    assert D(r["effectif"]["var_pct"]) == 0
    assert (r["entrees"], r["sorties"]) == (1, 1)  # E4 arrive, E3 part
    sav = axe(r, "service", "SAV PL")
    assert (sav["effectif"], sav["effectif1"], sav["entrees"], sav["sorties"]) == (2, 1, 1, 0)
    adm = axe(r, "service", "Administration")
    assert (adm["effectif"], adm["effectif1"], adm["sorties"]) == (0, 1, 1)
    assert {x["libelle"]: (x["n"], x["n1"], x["entrees"], x["sorties"])
            for x in r["effectifs_contrat"]} == {"CDI": (2, 2, 1, 1), "CDD": (1, 1, 0, 0)}
    # variations d'effectif calculées par le serveur (ratio, 1 = +100 %)
    assert (sav["effectif_var"], D(sav["effectif_var_pct"])) == (1, D(1))
    assert (adm["effectif_var"], D(adm["effectif_var_pct"])) == (-1, D(-1))
    cdi = next(x for x in r["effectifs_contrat"] if x["libelle"] == "CDI")
    assert (cdi["var"], D(cdi["var_pct"])) == (0, D(0))
    # part de chaque contrat dans l'effectif, calculée par le serveur
    assert D(cdi["part"]) == D(2) / 3
    assert sum(D(x["part"]) for x in r["effectifs_contrat"]) == 1
    # sans période comparée : ni entrées ni sorties
    un = get(charge, "charges", **JAN).json()
    assert un["effectif"] == {"n": 3, "n1": None, "var": None, "var_pct": None}
    assert un["entrees"] is None and un["sorties"] is None
    # le détail du montant sert aussi : un montant nul n'est pas une personne payée
    assert sum(x["effectif"] for x in lignes_axe(r, "activite")) == 3


def test_comparaison_partielle(charge):
    # 2025-12 n'a pas de données, 2026-01 oui : la comparaison est partielle
    r = get(charge, "charges", **PLAGE2, cmp_du="2025-12", cmp_au="2026-01").json()
    assert r["partiel"] is True and D(r["total"]["m1"]) == D("7400.5")
    # tous les mois comparés ont des données, ou aucun : pas de note
    assert get(charge, "charges", **FEV).json()["partiel"] is False
    sans = get(charge, "charges", **JAN).json()
    assert sans["partiel"] is False and sans["total"]["m1"] is None
    assert all(x["m1"] is None and x["var"] is None
               for cle in AXES for x in lignes_axe(sans, cle))


def budgeter(db, rubrique=None, service=None, site=None):
    pid = db.scalar(select(Periode.id).where(Periode.annee == 2026, Periode.mois == 1))
    for axe_, modele, valeurs in (("rubrique", Rubrique, rubrique), ("service", Service, service),
                                  ("site", Site, site)):
        for lib, v in (valeurs or {}).items():
            cible = db.scalar(select(modele.id).where(modele.libelle == lib))
            db.add(Budget(periode_id=pid, axe=axe_, cible_id=cible, valeur=D(v)))
    db.commit()


def test_budgets_par_axe(charge, db):
    budgeter(db, {BR: 5000, "Salaire brut garantie": 200}, {"SAV PL": 1500}, {"Douala": 1200})
    r = get(charge, "charges", **JAN).json()
    assert D(axe(r, "type", BR)["budget"]) == 5000
    assert axe(r, "type", "Charges Patronales")["budget"] is None
    assert D(axe(r, "site", "Douala")["budget"]) == 1200 and axe(r, "site", "Yaoundé")["budget"] is None
    assert D(axe(r, "service", "SAV PL")["budget"]) == 1500
    assert axe(r, "service", "Commerce VN")["budget"] is None
    assert all(r["axes"][k]["budget_raison"] is None for k in ("type", "site", "service"))
    assert all(x["budget"] is None for x in lignes_axe(r, "activite") + lignes_axe(r, "contrat"))
    assert r["axes"]["activite"]["budget_raison"] == "Budget non suivi par activité."
    assert r["axes"]["contrat"]["budget_raison"] == "Budget non suivi par nature de contrat."
    # réalisation du budget calculée par le serveur : réel / budget, sans budget : rien
    assert D(axe(r, "type", BR)["realisation"]) == D("7000.5") / 5000
    assert axe(r, "type", "Charges Patronales")["realisation"] is None
    assert D(axe(r, "service", "SAV PL")["realisation"]) == D("1130.5") / 1500
    assert D(axe(r, "service", "SAV PL")["ecart_budget"]) == D("1130.5") - 1500
    assert axe(r, "service", "Commerce VN")["ecart_budget"] is None
    # un service sans budget : pas de budget pour le total de l'axe
    assert r["axes"]["service"]["budget_total"] is None
    # période sans budget (février) : rien
    fev = get(charge, "charges", **FEV).json()
    assert axe(fev, "type", BR)["budget"] is None and axe(fev, "service", "SAV PL")["budget"] is None
    # budget cumulé sur les mois de la période : seul janvier en a un
    deux = get(charge, "charges", **PLAGE2).json()
    assert D(axe(deux, "type", BR)["budget"]) == 5000


def test_budget_total_de_l_axe_calcule_par_le_serveur(charge, db):
    budgeter(db, {BR: 5000}, {"SAV PL": 1500, "Commerce VN": 2000, "Administration": 500}, {})
    r = get(charge, "charges", **JAN).json()
    tot = r["axes"]["service"]["budget_total"]
    assert D(tot["budget"]) == 4000
    assert D(tot["realisation"]) == D(r["total"]["m"]) / 4000
    assert D(tot["ecart_budget"]) == D(r["total"]["m"]) - 4000
    assert r["axes"]["type"]["budget_total"] is None  # une seule rubrique a un budget


def test_budgets_masques_par_les_filtres(charge, db):
    budgeter(db, {BR: 5000}, {"SAV PL": 1500}, {"Douala": 1200})
    r = get(charge, "charges", **JAN, service="SAV PL").json()
    assert all(x["budget"] is None for x in lignes_axe(r, "type"))
    assert r["axes"]["type"]["budget_raison"].startswith(
        "Budget par type de charge saisi pour toute l'entreprise")
    assert all(x["budget"] is None for x in lignes_axe(r, "site"))
    assert r["axes"]["site"]["budget_raison"].startswith("Budget par site non découpé")
    assert D(axe(r, "service", "SAV PL")["budget"]) == 1500
    site = get(charge, "charges", **JAN, site="Douala").json()
    assert D(axe(site, "site", "Douala")["budget"]) == 1200
    assert site["axes"]["service"]["budget_raison"].startswith("Budget par service non découpé")
    assert all(x["budget"] is None for x in lignes_axe(site, "service"))
    assert get(charge, "charges", **JAN, activite="Front office").json()["axes"]["type"][
        "budget_raison"].startswith("Budget par type de charge")
    assert all(x["budget"] is None for cle in AXES for x in lignes_axe(
        get(charge, "charges", **JAN, type_contrat="CDI").json(), cle))


def test_budgets_departement_et_perimetre(charge, make_client, db):
    budgeter(db, {BR: 5000}, {"SAV PL": 1500}, {"Douala": 1200})
    r = get(charge, "charges", **JAN, departement="Equipment").json()
    # un département restreint par service : le budget service reste visible, pas rubrique ni site
    assert D(axe(r, "service", "SAV PL")["budget"]) == 1500
    assert all(x["budget"] is None for x in lignes_axe(r, "type") + lignes_axe(r, "site"))
    assert r["axes"]["service"]["budget_raison"] is None
    assert r["axes"]["type"]["budget_raison"].startswith("Budget par type de charge")
    assert r["axes"]["site"]["budget_raison"].startswith("Budget par site non découpé")
    # le filtre Département est cité, même sur un compte non restreint
    assert "Département" in r["axes"]["type"]["budget_raison"]
    assert "département" in r["axes"]["site"]["budget_raison"]
    equip = get(make_client(EQUIP), "charges", **JAN).json()
    assert D(axe(equip, "service", "SAV PL")["budget"]) == 1500
    assert all(x["budget"] is None for x in lignes_axe(equip, "type"))
    assert "Département" not in equip["axes"]["type"]["budget_raison"]
    assert "compte à périmètre" in equip["axes"]["type"]["budget_raison"]


def test_raison_budget_et_periode_avant_la_saisie():
    avant = kc.Contexte(debut=2024 * 12 + 11)
    assert [kc.raison_budget(avant, a) for a in ("type", "site", "activite")] == [
        "Budget saisi à partir de janv. 2025 : la période choisie commence avant."] * 3
    ctx = kc.Contexte(debut=2025 * 12)
    assert kc.raison_budget(ctx, "type") is None and kc.raison_budget(None, "type") is None
    assert kc.raison_budget(kc.Contexte(2025 * 12, perimetre=True), "type") is not None
    assert kc.raison_budget(kc.Contexte(2025 * 12, perim_service=True), "site") is not None
    assert kc.raison_budget(kc.Contexte(2025 * 12, perim_site=True), "service") is not None
    assert kc.raison_budget(kc.Contexte(2025 * 12, poste=True), "service") is not None
    # un budget existe mais la période commence avant janvier 2025 : il n'est pas affiché
    pd = PeriodeData((Ligne(1, "S", "Douala", "Front office", "CDI", {"Brut Réel": D(10)}),))
    r = kc.rapport([pd], [], ("Brut Réel",), [Budgets({"Brut Réel": D(5)}, {"S": D(5)})], avant)
    assert all(x["budget"] is None for cle in AXES for x in r["axes"][cle]["lignes"])
    r = kc.rapport([pd], [], ("Brut Réel",), [Budgets({"Brut Réel": D(5)}, {"S": D(5)})], ctx)
    assert r["axes"]["type"]["lignes"][0]["budget"] == 5
    assert r["axes"]["service"]["lignes"][0]["budget"] == 5


def test_objectif_masse_salariale_par_vente():
    """Objectif = budget total de la période (budget par employé x effectif) / objectif de ventes."""
    n = {1: periode_act([ligne_act(1, **{VENTES: 3}), ligne_act(2, **{VENTES: 2})], [objectif_act("obj_ventes", 5)])}
    r = annuel(n, {}, 1, REFS, Params(budget_employe=D(700)))
    ms = next(x for x in r["activite"] if x["cle"] == "ms_par_vente")
    assert ms["budget"] == D(1400) / 5 and ms["m"] == D(2000) / 5
    assert ms["realisation"] == ms["m"] / ms["budget"]
    # sans objectif de ventes ou sans budget par employé : pas d'objectif
    sans = {1: periode_act([ligne_act(1, **{VENTES: 3}), ligne_act(2, **{VENTES: 2})])}
    assert next(x for x in annuel(sans, {}, 1, REFS, Params(budget_employe=D(700)))["activite"]
                if x["cle"] == "ms_par_vente")["budget"] is None
    sans_budget = annuel(n, {}, 1, REFS, Params(budget_employe=None))
    assert next(x for x in sans_budget["activite"] if x["cle"] == "ms_par_vente")["budget"] is None


def test_carte_activite_cout_par_vente_et_objectifs_atteints():
    def ligne_(cle, m, m1, budget=None):
        return {"cle": cle, "m": D(m), "m1": D(m1), "budget": None if budget is None else D(budget),
                "ecart": None, "ecart_pct": None,
                "realisation": None if budget is None else D(m) / D(budget), "budget_partiel": True}

    res = {"activite": [ligne_("ventes", 10, 5, 8), ligne_("clients", 2, 2, 4),
                        ligne_("or", 3, 3)], "lignes_ca_marge": {"ca": {"m": D(1)}}}
    total = {"m": D(1000), "m1": D(400)}
    out = _bloc_activite_charges(res, total, False, 2026 * 12)
    assert out["cout_par_vente"] == {"n": D(100), "n1": D(80), "var": D(20),
                                      "var_pct": D("0.25")}
    assert out["objectifs_atteints"] == [1, 2]
    assert out["lignes_ca_marge"] == {"ca": {"m": D(1)}}
    # objectifs masqués (filtre service ou site, périmètre) : plus d'objectif, plus d'atteints
    masque = _bloc_activite_charges(res, total, True, 2026 * 12)
    assert masque["objectifs_atteints"] is None
    assert all(x.get("budget") is None and "budget_partiel" not in x for x in masque["activite"])
    # période avant la saisie des budgets
    assert _bloc_activite_charges(res, total, False, 2024 * 12)["objectifs_atteints"] is None
    # pas de ventes : pas de coût par vente
    vide = _bloc_activite_charges({"activite": None}, total, False, 2026 * 12)
    assert vide["activite"] is None and vide["cout_par_vente"] == {"n": None, "n1": None,
                                                                    "var": None, "var_pct": None}


def test_charges_carte_activite_sans_donnee_d_activite(charge):
    r = get(charge, "charges", **JAN).json()
    assert r["activite"] is None and r["objectifs_atteints"] is None
    assert r["cout_par_vente"] == {"n": None, "n1": None, "var": None, "var_pct": None}
    assert "lignes_ca_marge" not in r or r["lignes_ca_marge"] is not None


# ---------- partiel, Primes, serveur ----------


def _mois(brut):
    return PeriodeData((Ligne(1, "S", "Douala", "Front", "CDI", {"Brut Réel": D(brut)}),))


def test_partiel_dans_les_deux_sens():
    a, b = _mois(10), _mois(20)
    paie = ("Brut Réel",)
    # un mois de N avec données sans correspondant dans la comparaison
    r = kc.rapport([a, b], [None, a], paie)
    assert r["partiel"] is True and r["total"]["m"] == 30 and r["total"]["m1"] == 10
    # un mois comparé avec données sans mois correspondant dans N : il ne compte pas
    r = kc.rapport([None, b], [a, a], paie)
    assert r["partiel"] is True and r["total"]["m"] == 20 and r["total"]["m1"] == 10
    # tout est apparié, ou aucun mois comparé : pas de note
    assert kc.rapport([a, b], [a, b], paie)["partiel"] is False
    r = kc.rapport([a], [None], paie)
    assert r["partiel"] is False and r["total"]["m1"] is None


def test_partiel_endpoint_mois_compare_sans_correspondant(charge):
    # mars 2026 n'a pas de données alors que février 2026 (comparé) en a : janvier seul est apparié
    r = get(charge, "charges", du="2026-02", au="2026-03", cmp_du="2026-01",
            cmp_au="2026-02").json()
    assert r["partiel"] is True
    assert D(r["total"]["m"]) == 3810 and D(r["total"]["m1"]) == D("7400.5")


def test_primes_d_un_mois_seul_comparees_au_meme_mois_un_an_plus_tot():
    primes = "Primes exceptionnelles"
    paie = ("Brut Réel", primes)

    def mois(brut, prime):
        return PeriodeData((Ligne(1, "S", "Douala", "Front", "CDI",
                                  {"Brut Réel": D(brut), primes: D(prime)}),))

    n, precedent, an_passe = [mois(100, 40)], [mois(90, 30)], [mois(80, 10)]
    r = kc.rapport(n, precedent, paie, n1_primes=an_passe)
    types = {x["libelle"]: x for x in r["axes"]["type"]["lignes"]}
    assert types[primes]["m1"] == 10 and types[primes]["cmp_primes"] is True
    assert types["Brut Réel"]["m1"] == 90 and "cmp_primes" not in types["Brut Réel"]
    # le total et les autres axes restent sur la comparaison reçue
    assert r["total"]["m1"] == 120
    assert r["axes"]["site"]["lignes"][0]["m1"] == 120
    # comparaison explicite (ou plage) : rien ne change
    types = {x["libelle"]: x for x in kc.rapport(n, precedent, paie)["axes"]["type"]["lignes"]}
    assert types[primes]["m1"] == 30 and "cmp_primes" not in types[primes]
    # liste nominative : mêmes mois comparés
    liste = kc.personnes(n, precedent, paie, "type", primes, n1_primes=an_passe)
    assert liste is not None and liste[0]["m1"] == 10
    assert kc.personnes(n, precedent, paie, "type", "Brut Réel", n1_primes=an_passe)[0]["m1"] == 90


def test_primes_mois_seul_endpoint(charge):
    fev = get(charge, "charges", **FEV).json()
    assert (fev["cmp_du"], fev["cmp_au"]) == ("2026-01", "2026-01")
    assert (fev["cmp_primes_du"], fev["cmp_primes_au"]) == ("2025-02", "2025-02")
    assert D(fev["total"]["m1"]) == D("7400.5")  # le total reste sur janvier
    assert not any(x["libelle"] in ("Primes exceptionnelles", "Bonus", "Primes sur ventes")
                   for x in lignes_axe(fev, "type"))
    jan = get(charge, "charges", **JAN).json()
    assert jan["cmp_primes_du"] is None and jan["cmp_primes_au"] is None
    # plage : pas de règle Primes
    plage = get(charge, "charges", **PLAGE2).json()
    assert plage["cmp_primes_du"] is None


def test_charges_avec_ventes_et_objectifs_d_activite(make_client, db):
    """Carte Activité calculée sur les montants du moteur : ventes, objectifs, coût par vente."""
    c = make_client(ADMIN)
    objectifs_charges(c, db)
    r = get(c, "charges", **JAN)
    assert r.status_code == 200, r.text
    r = r.json()
    par = {x["cle"]: x for x in r["activite"]}
    assert D(par["ventes"]["m"]) == 5 and D(par["ventes"]["budget"]) == 10
    assert D(par["ventes"]["realisation"]) == D("0.5")
    assert D(r["total"]["m"]) == 3500
    assert D(r["cout_par_vente"]["n"]) == 700 and r["cout_par_vente"]["n1"] is None
    assert r["cout_par_vente"]["var_pct"] is None
    assert r["objectifs_atteints"] is not None
    # un filtre de service masque les objectifs
    masque = get(c, "charges", **JAN, service="SAV PL").json()
    assert masque["objectifs_atteints"] is None
    assert {x["cle"]: x for x in masque["activite"]}["ventes"]["budget"] is None


def test_bloc_activite_ne_recoit_que_perimetre_service_site(charge, monkeypatch):
    import app.api.rapports as rapports
    vus: list[tuple] = []
    reel = rapports._calcul_annuel

    def espion(db, p, *args, **kw):
        vus.append(args)
        return reel(db, p, *args, **kw)

    monkeypatch.setattr(rapports, "_calcul_annuel", espion)
    r = get(charge, "charges", **JAN, service="SAV PL", site="Douala", type_site="principal",
            poste="P", activite="Front office", type_contrat="CDI", departement="Equipment")
    assert r.status_code == 200, r.text
    (args,) = vus
    # annee, mois, service, site, ref_annee, type_site, poste, matricule, activite, type_contrat
    assert args[2:4] == ("SAV PL", "Douala") and args[5] == "principal"
    assert args[6] is None and args[7] is None and args[8] is None and args[9] is None
    assert args[11] == "Equipment"  # le département restreint le périmètre


def test_budget_ms_limite_aux_mois_avec_objectif_de_ventes():
    deux = [ligne_act(1, **{VENTES: 3}), ligne_act(2, **{VENTES: 2})]
    n = {1: periode_act(deux, [objectif_act("obj_ventes", 5)]), 2: periode_act(deux)}
    r = annuel(n, {}, 2, REFS, Params(budget_employe=D(700)))
    ms = next(x for x in r["activite"] if x["cle"] == "ms_par_vente")
    # seul le mois 1 a un objectif de ventes : 1400 / 5 (et non 2800 / 5)
    assert ms["budget"] == D(1400) / 5


def test_mensuel_fournit_l_objectif_ms_par_vente():
    cur = periode_act([ligne_act(1, **{VENTES: 3}), ligne_act(2, **{VENTES: 2})],
                      [objectif_act("obj_ventes", 5)])
    r = mensuel(cur, None, REFS, Params(budget_employe=D(700)))
    ms = next(x for x in r["activite"] if x["cle"] == "ms_par_vente")
    assert ms["budget"] == D(1400) / 5 and ms["realisation"] == ms["m"] / ms["budget"]


def test_part_par_personne_calculee_par_le_serveur(charge, make_client):
    liste = pers(make_client(DRH), "type", BR, **FEV).json()
    total = sum(D(x["m"]) for x in liste)
    assert total == 3700
    assert all(D(x["part"]) == D(x["m"]) / total for x in liste)
    assert sum(D(x["part"]) for x in liste) == pytest.approx(D(1))


def test_raison_budget_sous_filtre_de_profil():
    ctx = kc.Contexte(2025 * 12, profil=True)
    assert kc.raison_budget(ctx, "type") == "Budget non suivi par sexe, âge ni ancienneté."
    assert kc.raison_budget(ctx, "activite") == "Budget non suivi par activité."
