"""Saisies du mois à un seul niveau par groupe : CA et marge, OR, devis et factures
(GET et PUT /pilotage/saisies), niveau, droits, périmètre, audit, exactitude."""

from decimal import Decimal as D
from io import BytesIO

import pytest
from openpyxl import load_workbook
from sqlalchemy import func, select

from app.api import pilotage
from app.kpi.chargement import charger_periode, filtrer
from app.kpi.moteur import CA_INDIVIDUEL, MARGE_INDIVIDUELLE, Params, mensuel
from app.models.auth import AuditEvent
from app.models.donnees import Periode
from app.models.pilotage import DateEmployes, ValeurSaisie
from app.models.referentiel import Service, Site
from app.repos.scope import Scope
from tests.conftest import mot_de_passe_choisi
from tests.test_donnees_activite import _sans_marge, charger, envoyer, lig
from tests.test_donnees_api import ADMIN, API, BR, DRH
from tests.test_kpi_moteur import REFS
from tests.test_rapports_api import EQUIP, get

URL = f"{API}/pilotage/saisies"
P = {"annee": 2026, "mois": 1}
RESTREINT = Scope(False, {"site": frozenset({"Douala"}), "service": frozenset({"SAV PL"})})


def ids(db):
    return ({s.libelle: s.id for s in db.scalars(select(Site))},
            {s.libelle: s.id for s in db.scalars(select(Service))})


def lire(c, groupe="ca_marge", **kw):
    return c.get(URL, params={**P, "groupe": groupe, **kw})


def saisir(c, groupe, niveau, cases, **kw):
    return c.put(URL, json={**P, "groupe": groupe, "niveau": niveau, "cases": cases, **kw})


def case(site=None, service=None, **valeurs):
    return {"site_id": site, "service_id": service, "valeurs": valeurs}


def nb_lignes(db, *indicateurs):
    q = select(func.count()).select_from(ValeurSaisie)
    if indicateurs:
        q = q.where(ValeurSaisie.indicateur.in_(indicateurs))
    return db.scalar(q)


def nb_periodes(db):
    return db.scalar(select(func.count()).select_from(Periode))


def par_cle(j):
    return {(x["site_id"], x["service_id"]): x["valeurs"] for x in j["cases"]}


def charger_ca_individuel(c):
    charger(c, [
        lig(**{BR: 1000, CA_INDIVIDUEL: 500, MARGE_INDIVIDUELLE: 50}),
        lig(MATRICULE="E2", Noms="Bob", **{BR: 1000, CA_INDIVIDUEL: 300}),
        lig(MATRICULE="E3", Noms="Cy", Service="Commerce VN", Site="Yaoundé",
            **{BR: 500, CA_INDIVIDUEL: 200, MARGE_INDIVIDUELLE: 20}),
    ])


# ---------- lecture ----------


def test_lecture_sans_employe_global_par_defaut_et_ne_cree_rien(make_client, db):
    c = make_client(ADMIN)
    j = lire(c).json()
    assert (j["niveau"], j["niveau_par_defaut"], j["indicateurs"]) == ("global", True,
                                                                      ["ca", "marge"])
    assert j["periode_id"] is None and j["taux_marge"] is None
    assert [(x["site_id"], x["service_id"]) for x in j["cases"]] == [(None, None)]
    assert j["totaux"]["ca"] == {"valeur": None, "partiel": True, "renseignes": 0, "attendus": 1}
    assert {s["libelle"] for s in j["sites"]} >= {"Douala", "Yaoundé"}
    assert all("productif" in s for s in j["services"])
    a = lire(c, "activite").json()
    assert (a["niveau"], a["niveau_par_defaut"], a["indicateurs"]) == (
        "cellule", True, ["or", "devis", "factures"])
    assert "taux_marge" not in a
    assert nb_periodes(db) == 0 and nb_lignes(db) == 0


def test_lecture_ca_individuel_des_employes_par_cellule_par_defaut(make_client, db):
    c = make_client(ADMIN)
    charger_ca_individuel(c)
    sites, services = ids(db)
    j = lire(c).json()
    assert (j["niveau"], j["niveau_par_defaut"]) == ("cellule", True)
    d = par_cle(j)
    v = d[(sites["Douala"], services["SAV PL"])]["ca"]
    assert v == {"saisi": None, "employes": "800.000", "valeur": "800.000", "origine": "calcule",
                 "ecart": None, "propose": None, "conflit": False}
    assert d[(sites["Yaoundé"], services["Commerce VN"])]["marge"]["valeur"] == "20.000"
    assert j["totaux"]["ca"]["valeur"] == "1000.000" and not j["totaux"]["ca"]["partiel"]
    assert D(j["taux_marge"]) == D("0.07")


@pytest.mark.parametrize("groupe,droit_manquant", [("ca_marge", True), ("activite", False)])
def test_lecture_droits(make_client, db, groupe, droit_manquant):
    assert lire(make_client(DRH), groupe).status_code == 403  # lecture = droit d'import
    assert lire(make_client(), groupe).status_code == 401
    assert lire(make_client(ADMIN), "inconnu").status_code == 422
    _sans_marge(db)
    r = lire(make_client(ADMIN), groupe)
    assert r.status_code == (403 if droit_manquant else 200)


# ---------- écriture, par niveau ----------


def test_ecriture_global(make_client, db):
    c = make_client(ADMIN)
    r = saisir(c, "ca_marge", "global", [case(ca="1000,5", marge="-200")])
    assert r.status_code == 200, r.text
    j = r.json()
    assert (j["niveau"], j["niveau_par_defaut"], j["niveau_enregistre"]) == ("global", False,
                                                                           "global")
    assert j["cases"][0]["valeurs"]["ca"]["valeur"] == "1000.500"
    assert j["cases"][0]["valeurs"]["marge"]["valeur"] == "-200.000"
    assert j["totaux"]["ca"]["valeur"] == "1000.500" and not j["totaux"]["ca"]["partiel"]
    assert D(j["taux_marge"]) == D("-200") / D("1000.5")
    assert j == lire(c).json()
    assert nb_periodes(db) == 1 and nb_lignes(db) == 2


def test_ecriture_site_service_et_cellule(make_client, db):
    c = make_client(ADMIN)
    sites, services = ids(db)
    d, y = sites["Douala"], sites["Yaoundé"]
    sav, vn = services["SAV PL"], services["Commerce VN"]

    j = saisir(c, "ca_marge", "site", [case(site=d, ca="100", marge="10"),
                                      case(site=y, ca="50")]).json()
    assert j["niveau"] == "site" and j["totaux"]["ca"]["valeur"] == "150.000"
    assert par_cle(j)[(d, None)]["marge"]["valeur"] == "10.000"
    assert j["totaux"]["marge"]["valeur"] == "10.000" and j["totaux"]["marge"]["partiel"]

    j = saisir(c, "ca_marge", "service", [case(service=sav, ca="70"),
                                         case(service=vn, ca="30.25")]).json()
    assert j["niveau"] == "service" and j["totaux"]["ca"]["valeur"] == "100.250"

    j = saisir(c, "ca_marge", "cellule", [case(d, sav, ca="5", marge="1")]).json()
    assert j["niveau"] == "cellule"
    assert par_cle(j)[(d, sav)]["ca"]["origine"] == "saisi"

    j = saisir(c, "activite", "service", [case(service=sav, **{"or": "9", "devis": "3"})]).json()
    assert j["niveau"] == "service" and j["totaux"]["or"]["valeur"] == "9.000"
    assert j["totaux"]["factures"]["valeur"] is None


def test_changer_de_niveau_supprime_les_anciennes_lignes(make_client, db):
    c = make_client(ADMIN)
    sites, services = ids(db)
    saisir(c, "ca_marge", "global", [case(ca="1000", marge="100")])
    saisir(c, "activite", "cellule", [case(sites["Douala"], services["SAV PL"], **{"or": "4"})])
    assert nb_lignes(db) == 3
    j = saisir(c, "ca_marge", "site", [case(site=sites["Douala"], ca="600")]).json()
    # le CA et la marge globaux ont disparu, l'activité n'est pas touchée
    rows = db.execute(select(ValeurSaisie.indicateur, ValeurSaisie.site_id,
                             ValeurSaisie.service_id)).all()
    assert sorted(map(tuple, rows), key=str) == sorted(
        [("ca", sites["Douala"], None), ("or", sites["Douala"], services["SAV PL"])], key=str)
    assert j["niveau"] == "site" and j["totaux"]["ca"]["valeur"] == "600.000"
    assert j["totaux"]["marge"]["valeur"] is None


def test_valeur_nulle_ou_vide_supprime_la_ligne(make_client, db):
    c = make_client(ADMIN)
    sites, services = ids(db)
    cell = (sites["Douala"], services["SAV PL"])
    saisir(c, "activite", "cellule", [case(*cell, **{"or": "7", "devis": "3"})])
    j = saisir(c, "activite", "cellule", [case(*cell, **{"or": "", "devis": None})]).json()
    assert nb_lignes(db) == 0
    assert cell not in par_cle(j)  # plus aucune valeur : la case n'est plus attendue


def test_valeurs_exactes_jamais_arrondies(make_client, db):
    c = make_client(ADMIN)
    sites, services = ids(db)
    cell = (sites["Douala"], services["SAV PL"])
    j = saisir(c, "activite", "cellule", [case(*cell, **{"or": "3.1234567",
                                                          "factures": "0,1234567"})]).json()
    v = par_cle(j)[cell]
    assert v["or"]["valeur"] == "3.1234567" and v["factures"]["valeur"] == "0.1234567"
    db.expire_all()
    assert db.scalar(select(ValeurSaisie.valeur).where(ValeurSaisie.indicateur == "or")) is not None
    ca = saisir(c, "ca_marge", "global", [case(ca="1234567.891")]).json()
    assert ca["cases"][0]["valeurs"]["ca"]["valeur"] == "1234567.891"


def test_le_saisi_gagne_et_l_ecart_est_le_non_reparti(make_client, db):
    c = make_client(ADMIN)
    charger_ca_individuel(c)
    sites, services = ids(db)
    cell = (sites["Douala"], services["SAV PL"])
    j = saisir(c, "ca_marge", "cellule", [case(*cell, ca="1000")]).json()
    v = par_cle(j)[cell]["ca"]
    assert (v["saisi"], v["employes"], v["valeur"], v["origine"], v["ecart"]) == (
        "1000.000", "800.000", "1000.000", "saisi", "200.000")
    # la case saisie ne s'ajoute pas aux employés, l'autre case reste calculée
    assert j["totaux"]["ca"]["valeur"] == "1200.000"
    # même niveau que le défaut : les employés des autres niveaux ne sont pas mêlés
    j = saisir(c, "ca_marge", "global", [case(ca="900")]).json()
    assert j["cases"][0]["valeurs"]["ca"]["ecart"] == "-100.000"


# ---------- validation, droits, périmètre, audit ----------


def test_422_sans_rien_ecrire_ni_ouvrir_le_mois(make_client, db):
    c = make_client(ADMIN)
    sites, services = ids(db)
    d, sav = sites["Douala"], services["SAV PL"]
    bonne = case(d, sav, **{"or": "5"})
    mauvaises = [
        ("activite", "cellule", [bonne, case(d, sav, ventes="1")]),
        ("activite", "cellule", [bonne, case(d, sav, devis="-1")]),
        ("activite", "cellule", [bonne, case(d, sav, devis="abc")]),
        ("activite", "cellule", [bonne, case(d, sav, devis="1e5")]),
        ("activite", "cellule", [bonne, case(d, sav, devis="NaN")]),
        ("activite", "cellule", [bonne, case(99999, sav, devis="1")]),
        ("activite", "cellule", [bonne, case(d, 99999, devis="1")]),
        ("activite", "cellule", [bonne, bonne]),  # case en double
        ("activite", "site", [case(d, sav, **{"or": "5"})]),  # case incohérente avec le niveau
        ("activite", "cellule", [case(d, None, **{"or": "5"})]),
        ("activite", "inconnu", [bonne]),
        ("inconnu", "cellule", [bonne]),
        ("ca_marge", "global", [case(marge="5")]),  # marge sans CA
        ("ca_marge", "global", [case(ca="5", marge="abc")]),
        ("ca_marge", "global", [case(ca="-5")]),  # CA négatif
    ]
    for groupe, niveau, cases in mauvaises:
        r = saisir(c, groupe, niveau, cases)
        assert r.status_code == 422, (groupe, niveau, cases, r.text)
    assert nb_lignes(db) == 0 and nb_periodes(db) == 0


def test_marge_sans_ca_utilise_celui_des_employes_ou_deja_saisi(make_client, db):
    c = make_client(ADMIN)
    sites, services = ids(db)
    cell = (sites["Douala"], services["SAV PL"])
    assert saisir(c, "ca_marge", "global", [case(marge="5")]).status_code == 422
    assert saisir(c, "ca_marge", "global", [case(ca="10")]).status_code == 200
    assert saisir(c, "ca_marge", "global", [case(marge="5")]).status_code == 200  # CA déjà saisi
    charger_ca_individuel(c)
    assert saisir(c, "ca_marge", "cellule", [case(*cell, marge="5")]).status_code == 200


def test_marge_negative_permise_ca_negatif_refuse(make_client):
    c = make_client(ADMIN)
    assert saisir(c, "ca_marge", "global", [case(ca="10", marge="-3")]).status_code == 200
    assert saisir(c, "ca_marge", "global", [case(ca="-10")]).status_code == 422


def test_droits_d_ecriture(make_client, db):
    sites, services = ids(db)
    ok = case(sites["Douala"], services["SAV PL"], **{"or": "1"})
    for who in (DRH, EQUIP):
        assert saisir(make_client(who), "activite", "cellule", [ok]).status_code == 403
        assert saisir(make_client(who), "ca_marge", "global", [case(ca="1")]).status_code == 403
    assert saisir(make_client(), "activite", "cellule", [ok]).status_code == 401
    assert nb_lignes(db) == 0 and nb_periodes(db) == 0


def test_marge_read_exige_pour_le_ca_et_la_marge_pas_pour_l_activite(make_client, db):
    c = make_client(ADMIN)
    sites, services = ids(db)
    saisir(c, "ca_marge", "global", [case(ca="100", marge="10")])
    _sans_marge(db)
    assert saisir(c, "ca_marge", "global", [case(ca="1")]).status_code == 403
    assert lire(c).status_code == 403
    assert saisir(c, "activite", "cellule",
                  [case(sites["Douala"], services["SAV PL"], **{"or": "2"})]).status_code == 200
    assert lire(c, "activite").status_code == 200
    # aucune valeur de CA ou de marge ailleurs non plus
    for chemin in ("mensuel", "annuel"):
        j = get(c, chemin, annee=2026, mois=1).json()
        assert "lignes_ca_marge" not in j and "ca" not in j and "marge" not in j
    assert "ca" not in c.get(f"{API}/periodes").json()[0]
    v = c.get(f"{API}/pilotage", params=P)
    assert v.status_code == 403


def test_audit_et_envoi_sans_changement(make_client, db):
    c = make_client(ADMIN)
    saisir(c, "ca_marge", "global", [case(ca="100")])
    actions = db.scalars(select(AuditEvent.action).order_by(AuditEvent.id)).all()
    assert actions[-2:] == ["ouverture", "saisie_pilotage"]
    n = db.scalar(select(func.count()).select_from(AuditEvent))
    saisir(c, "ca_marge", "global", [case(ca="100")])
    assert db.scalar(select(func.count()).select_from(AuditEvent)) == n
    saisir(c, "ca_marge", "global", [case(ca="150")])
    ev = db.scalars(select(AuditEvent).where(AuditEvent.action == "saisie_pilotage")
                    .order_by(AuditEvent.id)).all()
    assert len(ev) == 2
    assert ev[-1].avant["valeurs"] == {"ca//": "100.000"}
    assert ev[-1].apres["valeurs"] == {"ca//": "150.000"}


def test_tout_vider_n_ouvre_pas_le_mois(make_client, db):
    c = make_client(ADMIN)
    sites, services = ids(db)
    r = saisir(c, "activite", "cellule", [case(sites["Douala"], services["SAV PL"], **{"or": ""})])
    assert r.status_code == 200 and r.json()["periode_id"] is None and nb_periodes(db) == 0


def test_perimetre_restreint(make_client, db, monkeypatch):
    c = make_client(ADMIN)
    sites, services = ids(db)
    d, y = sites["Douala"], sites["Yaoundé"]
    sav, vn = services["SAV PL"], services["Commerce VN"]
    saisir(c, "activite", "cellule", [case(d, sav, **{"or": "1"}), case(y, sav, **{"or": "2"}),
                                     case(d, vn, **{"or": "4"})])
    avant = nb_lignes(db)

    monkeypatch.setattr(pilotage, "scope_for", lambda _db, _p: RESTREINT)
    ok = case(d, sav, devis="5")
    for hors in (case(y, sav, **{"or": "9"}), case(d, vn, **{"or": "9"}), case(y, vn, **{"or": ""})):
        assert saisir(c, "activite", "cellule", [ok, hors]).status_code == 403
    # 422 avant 403
    assert saisir(c, "activite", "cellule", [case(y, sav, ventes="9")]).status_code == 422
    # changer de niveau ou saisir au niveau global exige un accès non restreint
    assert saisir(c, "activite", "service", [case(service=sav, devis="5")]).status_code == 403
    assert saisir(c, "ca_marge", "global", [case(ca="5")]).status_code == 403
    assert nb_lignes(db) == avant

    j = lire(c, "activite").json()
    assert [s["libelle"] for s in j["sites"]] == ["Douala"]
    assert [s["libelle"] for s in j["services"]] == ["SAV PL"]
    assert list(par_cle(j)) == [(d, sav)]
    assert j["totaux"]["or"]["valeur"] == "1.000"
    r = saisir(c, "activite", "cellule", [ok])
    assert r.status_code == 200 and nb_lignes(db) == avant + 1

    monkeypatch.setattr(pilotage, "scope_for", lambda _db, _p: Scope(False, {}))
    assert saisir(c, "activite", "cellule", [ok]).status_code == 403
    assert lire(c, "activite").json()["cases"] == []


# ---------- productif ----------


def test_service_productif_modifiable_et_renvoye(make_client, db):
    c = make_client(ADMIN)
    rid = db.scalar(select(Service.id).where(Service.libelle == "Commerce VN"))
    url = f"{API}/referentiels/service/{rid}"
    assert next(v for v in c.get(f"{API}/referentiels/service").json()["valeurs"]
                if v["id"] == rid)["productif"] is False
    r = c.put(url, json={"productif": True})
    assert r.status_code == 200, r.text
    assert r.json()["productif"] is True
    assert next(s for s in lire(c, "activite").json()["services"]
                if s["id"] == rid)["productif"] is True
    assert c.put(url, json={"productif": False}).json()["productif"] is False
    # le drapeau n'existe que pour les services
    sid = db.scalar(select(Site.id))
    assert c.put(f"{API}/referentiels/site/{sid}", json={"productif": True}).status_code == 422


# ---------- moteur : niveau des saisies et filtres ----------


def test_filtre_site_avec_ca_par_site_montre_le_ca(make_client, db):
    c = make_client(ADMIN)
    charger(c, [lig(**{BR: 1000}), lig(MATRICULE="E3", Noms="Cy", Service="Commerce VN",
                                      Site="Yaoundé", **{BR: 500})])
    sites, _ = ids(db)
    saisir(c, "ca_marge", "site", [case(site=sites["Douala"], ca="100", marge="10"),
                                  case(site=sites["Yaoundé"], ca="40", marge="4")])
    j = get(c, "mensuel", annee=2026, mois=1, site="Douala").json()
    assert D(j["lignes_ca_marge"]["ca"]["m"]) == 100
    assert D(j["lignes_ca_marge"]["marge"]["m"]) == 10
    j = get(c, "mensuel", annee=2026, mois=1).json()
    assert D(j["lignes_ca_marge"]["ca"]["m"]) == 140
    # un service ne peut pas être déduit d'une saisie par site
    j = get(c, "mensuel", annee=2026, mois=1, service="SAV PL").json()
    assert j["lignes_ca_marge"]["ca"]["m"] is None


def test_ca_global_masque_des_qu_un_filtre_est_choisi(make_client, db):
    c = make_client(ADMIN)
    charger(c, [lig(**{BR: 1000})])
    saisir(c, "ca_marge", "global", [case(ca="100", marge="10")])
    assert D(get(c, "mensuel", annee=2026, mois=1).json()["lignes_ca_marge"]["ca"]["m"]) == 100
    for filtre in ({"site": "Douala"}, {"service": "SAV PL"}, {"type_site": "principal"}):
        j = get(c, "mensuel", annee=2026, mois=1, **filtre).json()
        assert j["lignes_ca_marge"]["ca"]["m"] is None, filtre


def test_ca_individuel_des_employes_remonte_sans_saisie(make_client, db):
    c = make_client(ADMIN)
    charger_ca_individuel(c)
    j = get(c, "mensuel", annee=2026, mois=1).json()
    assert D(j["lignes_ca_marge"]["ca"]["m"]) == 1000
    assert D(j["lignes_ca_marge"]["marge"]["m"]) == 70
    j = get(c, "mensuel", annee=2026, mois=1, site="Yaoundé").json()
    assert D(j["lignes_ca_marge"]["ca"]["m"]) == 200
    j = get(c, "mensuel", annee=2026, mois=1, service="SAV PL").json()
    assert D(j["lignes_ca_marge"]["ca"]["m"]) == 800


def test_total_partiel_signale(make_client, db):
    c = make_client(ADMIN)
    charger(c, [lig(**{BR: 1000, CA_INDIVIDUEL: 500}),
                lig(MATRICULE="E3", Noms="Cy", Service="Commerce VN", Site="Yaoundé",
                    **{BR: 500})])
    j = get(c, "mensuel", annee=2026, mois=1).json()
    cell = j["lignes_ca_marge"]["ca"]
    assert D(cell["m"]) == 500 and cell["partiel"] is True
    assert "partiel" not in j["lignes_ca_marge"]["marge"]  # aucune marge : rien de partiel
    sites, services = ids(db)
    saisir(c, "ca_marge", "cellule", [case(sites["Yaoundé"], services["Commerce VN"], ca="30")])
    cell = get(c, "mensuel", annee=2026, mois=1).json()["lignes_ca_marge"]["ca"]
    assert D(cell["m"]) == 530 and "partiel" not in cell


def test_export_ca_marge_et_partiel(make_client):
    c = make_client(ADMIN)
    charger(c, [lig(**{BR: 1000, CA_INDIVIDUEL: 500}),
                lig(MATRICULE="E3", Noms="Cy", Service="Commerce VN", Site="Yaoundé",
                    **{BR: 500})])
    for vue in ("mensuel", "annuel"):
        r = get(c, f"{vue}/export", annee=2026, mois=1)
        rows = {x[0]: x[1:] for x in load_workbook(BytesIO(r.content))["1 Reporting global"]
                .iter_rows(min_row=2, values_only=True)}
        assert D(str(rows["Chiffre d'affaires (partiel)"][1])) == 500, vue
        assert "Marge" in rows, vue
    r = get(make_client(EQUIP), "mensuel/export", annee=2026, mois=1)
    noms = [x[0] for x in load_workbook(BytesIO(r.content))["1 Reporting global"].values]
    assert not any(n and n.startswith(("Chiffre", "Marge")) for n in noms)


def test_moteur_filtrer_et_partiel_sur_donnees_chargees(make_client, db):
    c = make_client(ADMIN)
    charger_ca_individuel(c)
    sites, services = ids(db)
    saisir(c, "activite", "cellule", [case(sites["Douala"], services["SAV PL"], **{"or": "10"})])
    pd = charger_periode(db, Scope(True, {}), 2026, 1)
    assert pd.ca == 1000 and pd.marge == 70
    assert "or" in pd.partiel and "ca" not in pd.partiel
    assert filtrer(pd, None, "Douala").ca == 800
    assert filtrer(pd, "Commerce VN", None).ca == 200
    assert filtrer(pd, None, None, poste="P").saisies == ()
    assert filtrer(pd, None, None, salarie_id=1).ca is None
    assert mensuel(pd, None, REFS, Params())["lignes_ca_marge"]["ca"]["m"] == 1000
    assert charger_periode(db, RESTREINT, 2026, 1).ca == 800


# ---------- changement de niveau à l'affichage ----------


def test_niveau_demande_propose_la_somme_d_un_niveau_plus_fin(make_client, db):
    c = make_client(ADMIN)
    sites, services = ids(db)
    d, y = sites["Douala"], sites["Yaoundé"]
    sav, vn = services["SAV PL"], services["Commerce VN"]
    saisir(c, "ca_marge", "cellule", [case(d, sav, ca="100.5", marge="10"),
                                     case(d, vn, ca="50"), case(y, vn, ca="7")])
    j = lire(c, niveau="site").json()
    assert (j["niveau"], j["niveau_enregistre"]) == ("site", "cellule")
    v = par_cle(j)
    assert D(v[(d, None)]["ca"]["propose"]) == D("150.5")
    assert D(v[(d, None)]["marge"]["propose"]) == 10
    assert D(v[(y, None)]["ca"]["propose"]) == 7 and v[(y, None)]["marge"]["propose"] is None
    assert j["a_repartir"] == {}
    g = lire(c, niveau="global").json()
    assert D(g["cases"][0]["valeurs"]["ca"]["propose"]) == D("157.5")
    assert nb_lignes(db) == 4  # la lecture n'écrit rien


def test_niveau_demande_plus_fin_donne_le_total_a_repartir(make_client, db):
    c = make_client(ADMIN)
    sites, _services = ids(db)
    saisir(c, "ca_marge", "site", [case(site=sites["Douala"], ca="600", marge="60")])
    j = lire(c, niveau="service").json()
    assert j["niveau"] == "service"
    assert all(x["valeurs"]["ca"]["propose"] is None for x in j["cases"])
    assert {k: D(v) for k, v in j["a_repartir"].items()} == {"ca": 600, "marge": 60}
    assert lire(c).json()["a_repartir"] == {}  # niveau en base : rien à répartir


def test_niveau_par_defaut_celui_du_dernier_mois_saisi(make_client, db):
    c = make_client(ADMIN)
    sites, _services = ids(db)
    saisir(c, "activite", "site", [case(site=sites["Douala"], **{"or": "3"})])
    j = c.get(URL, params={"annee": 2026, "mois": 3, "groupe": "activite"}).json()
    assert (j["niveau"], j["niveau_par_defaut"], j["niveau_enregistre"]) == ("site", True, None)
    assert lire(c, "activite", niveau="service").json()["niveau"] == "service"
    assert lire(c, niveau="inconnu").status_code == 422


def test_taux_de_marge_par_case(make_client, db):
    c = make_client(ADMIN)
    sites, _services = ids(db)
    j = saisir(c, "ca_marge", "site", [case(site=sites["Douala"], ca="200", marge="50"),
                                      case(site=sites["Yaoundé"], ca="100")]).json()
    t = {x["site_id"]: x["taux_marge"] for x in j["cases"]}
    assert D(t[sites["Douala"]]) == D("0.25") and t[sites["Yaoundé"]] is None
    assert "taux_marge" not in lire(c, "activite", niveau="site").json()["cases"][0]


# ---------- objectifs ----------

ANNEE = f"{API}/pilotage/saisies/annee"


def repartir(c, groupe, niveau, cases, annee=2026):
    return c.put(ANNEE, json={"annee": annee, "groupe": groupe, "niveau": niveau, "cases": cases})


def total(indicateur, valeur, site=None, service=None):
    return {"site_id": site, "service_id": service, "indicateur": indicateur, "total": valeur}


def valeurs_du_mois(c, groupe, indicateur, mois):
    j = lire(c, groupe, mois=mois).json()
    return [x["valeurs"][indicateur]["valeur"] for x in j["cases"]]


def test_objectifs_niveau_global_par_defaut_et_ecriture(make_client, db):
    c = make_client(ADMIN)
    for g in ("obj_ca_marge", "obj_activite"):
        j = lire(c, g).json()
        assert (j["niveau"], j["niveau_par_defaut"]) == ("global", True)
    r = saisir(c, "obj_ca_marge", "global", [case(obj_ca="5000,5", obj_marge="-200")])
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["cases"][0]["valeurs"]["obj_ca"]["valeur"] == "5000.500"
    assert j["cases"][0]["valeurs"]["obj_marge"]["valeur"] == "-200.000"
    assert j["cases"][0]["valeurs"]["obj_ca"]["origine"] == "saisi"
    assert "taux_marge" not in j or j["taux_marge"] is None
    assert nb_lignes(db, "obj_ca", "obj_marge") == 2 and nb_lignes(db, "ca", "marge") == 0
    # le réel (groupe ca_marge) n'est pas touché
    assert lire(c).json()["cases"][0]["valeurs"]["ca"]["valeur"] is None


def test_objectifs_d_activite_par_site_et_total_de_productivite_en_moyenne(make_client, db):
    c = make_client(ADMIN)
    sites, _ = ids(db)
    r = saisir(c, "obj_activite", "site", [
        case(sites["Douala"], None, obj_ventes="10", obj_productivite="80"),
        case(sites["Yaoundé"], None, obj_ventes="5", obj_productivite="90")])
    assert r.status_code == 200, r.text
    t = r.json()["totaux"]
    assert D(t["obj_ventes"]["valeur"]) == 15
    assert D(t["obj_productivite"]["valeur"]) == 85
    assert t["obj_clients"]["valeur"] is None
    # niveau enregistré : le prochain chargement le propose
    j = lire(c, "obj_activite").json()
    assert (j["niveau"], j["niveau_enregistre"]) == ("site", "site")


def test_objectifs_signes(make_client):
    c = make_client(ADMIN)
    assert saisir(c, "obj_ca_marge", "global", [case(obj_ca="10", obj_marge="-3")]).status_code == 200
    assert saisir(c, "obj_ca_marge", "global", [case(obj_ca="-3")]).status_code == 422
    assert saisir(c, "obj_activite", "global", [case(obj_ventes="-3")]).status_code == 422
    r = saisir(c, "obj_activite", "global", [case(obj_factures="2.5")])  # un nombre est entier
    assert r.status_code == 422 and "entier" in r.json()["detail"]
    assert saisir(c, "obj_activite", "global", [case(obj_factures="3.0")]).status_code == 200
    assert saisir(c, "obj_activite", "global", [case(obj_productivite="abc")]).status_code == 422
    assert saisir(c, "obj_activite", "global", [case(obj_ca="3")]).status_code == 422  # autre groupe


def test_objectifs_droits(make_client, db):
    sites, services = ids(db)
    ok = case(obj_ca="1")
    for who in (DRH, EQUIP):
        assert saisir(make_client(who), "obj_activite", "global",
                      [case(obj_ventes="1")]).status_code == 403
        assert saisir(make_client(who), "obj_ca_marge", "global", [ok]).status_code == 403
        assert repartir(make_client(who), "obj_activite", "global",
                        [total("obj_ventes", "12")]).status_code == 403
    assert saisir(make_client(), "obj_activite", "global", [case(obj_ventes="1")]).status_code == 401
    assert nb_lignes(db) == 0 and nb_periodes(db) == 0
    c = make_client(ADMIN)
    saisir(c, "obj_ca_marge", "global", [ok])
    _sans_marge(db)
    # CA et marge (réel comme objectif) exigent marge:read ; les objectifs d'activité non
    assert lire(c, "obj_ca_marge").status_code == 403
    assert saisir(c, "obj_ca_marge", "global", [ok]).status_code == 403
    assert repartir(c, "obj_ca_marge", "global", [total("obj_ca", "120")]).status_code == 403
    assert lire(c, "obj_activite").status_code == 200
    assert saisir(c, "obj_activite", "global", [case(obj_ventes="4")]).status_code == 200
    assert repartir(c, "obj_activite", "global", [total("obj_ventes", "12")]).status_code == 200
    assert nb_lignes(db, "obj_ca") == 1  # rien d'écrit par les refus


def test_repartition_annuelle_entier_le_reste_va_sur_decembre(make_client, db):
    c = make_client(ADMIN)
    r = repartir(c, "obj_activite", "global", [total("obj_ventes", "100")])
    assert r.status_code == 200, r.text
    j = r.json()
    assert (j["annee"], j["groupe"], j["niveau"], j["ecrases"]) == (2026, "obj_activite",
                                                                    "global", [])
    assert [m["mois"] for m in j["mois"]] == list(range(1, 13))
    mensuel = [D(m["cases"][0]["valeurs"]["obj_ventes"]) for m in j["mois"]]
    assert mensuel == [D(8)] * 11 + [D(12)] and sum(mensuel) == 100
    assert j["mois"][0]["cases"][0]["site_id"] is None
    for m in range(1, 13):  # relu depuis la base, au même résultat
        assert D(valeurs_du_mois(c, "obj_activite", "obj_ventes", m)[0]) == mensuel[m - 1]
    assert nb_periodes(db) == 12 and nb_lignes(db, "obj_ventes") == 12
    assert repartir(c, "obj_activite", "global", [total("obj_ventes", "12")]).json()["ecrases"] \
        == list(range(1, 13))


def test_repartition_annuelle_sur_l_exercice_fiscal_le_reste_va_sur_mars(make_client, db):
    c = make_client(ADMIN)
    r = c.put(ANNEE, json={"annee": 2026, "groupe": "obj_activite", "niveau": "global",
                           "calendrier": "fiscal", "cases": [total("obj_ventes", "100")]})
    assert r.status_code == 200, r.text
    j = r.json()
    attendu = [(2026, m) for m in range(4, 13)] + [(2027, m) for m in range(1, 4)]
    assert [(m["annee"], m["mois"]) for m in j["mois"]] == attendu
    assert [D(m["cases"][0]["valeurs"]["obj_ventes"]) for m in j["mois"]] == [D(8)] * 11 + [D(12)]
    assert D(valeurs_du_mois(c, "obj_activite", "obj_ventes", 4)[0]) == 8
    assert nb_periodes(db) == 12 and nb_lignes(db, "obj_ventes") == 12
    # en civil, janvier à mars 2026 sont neufs : seuls avril à décembre sont remplacés
    assert repartir(c, "obj_activite", "global", [total("obj_ventes", "24")]).json()["ecrases"]         == list(range(4, 13))


def test_repartition_annuelle_decimales_exactes_negatif_et_productivite(make_client):
    c = make_client(ADMIN)
    r = repartir(c, "obj_ca_marge", "global", [total("obj_ca", "10,5"), total("obj_marge", "-100")])
    assert r.status_code == 200, r.text
    ca = [D(m["cases"][0]["valeurs"]["obj_ca"]) for m in r.json()["mois"]]
    marge = [D(m["cases"][0]["valeurs"]["obj_marge"]) for m in r.json()["mois"]]
    assert ca == [D("0.8")] * 11 + [D("1.7")] and sum(ca) == D("10.5")
    assert marge == [D(-8)] * 11 + [D(-12)] and sum(marge) == -100
    assert D(valeurs_du_mois(c, "obj_ca_marge", "obj_ca", 12)[0]) == D("1.7")
    assert D(valeurs_du_mois(c, "obj_ca_marge", "obj_marge", 12)[0]) == -12
    # un total qui se divise sans reste ne laisse pas de reste
    r = repartir(c, "obj_ca_marge", "global", [total("obj_ca", "0.012")])
    assert {D(m["cases"][0]["valeurs"]["obj_ca"]) for m in r.json()["mois"]} == {D("0.001")}
    # productivité : la même valeur chaque mois, jamais divisée
    r = repartir(c, "obj_activite", "global", [total("obj_productivite", "85,5")])
    assert {D(m["cases"][0]["valeurs"]["obj_productivite"]) for m in r.json()["mois"]} == {
        D("85.5")}
    assert D(valeurs_du_mois(c, "obj_activite", "obj_productivite", 7)[0]) == D("85.5")


def test_repartition_annuelle_par_site_audit_par_mois_vide_efface_sans_ouvrir_de_mois(make_client, db):
    c = make_client(ADMIN)
    sites, _ = ids(db)
    r = repartir(c, "obj_activite", "site", [
        total("obj_ventes", "24", sites["Douala"]), total("obj_ventes", "36", sites["Yaoundé"]),
        total("obj_clients", "", sites["Douala"])])
    assert r.status_code == 200, r.text
    m1 = r.json()["mois"][0]["cases"]
    assert {x["site_id"]: x["valeurs"] for x in m1} == {
        sites["Douala"]: {"obj_ventes": "2", "obj_clients": None}, sites["Yaoundé"]: {"obj_ventes": "3"}}
    assert nb_lignes(db, "obj_ventes") == 24 and nb_lignes(db, "obj_clients") == 0
    ev = db.scalars(select(AuditEvent).where(AuditEvent.action == "saisie_pilotage")).all()
    assert len(ev) == 12  # une trace par mois
    n = nb_periodes(db)
    r = repartir(c, "obj_activite", "site", [total("obj_ventes", "", sites["Douala"])],
                 annee=2027)
    assert r.json() == {"annee": 2027, "calendrier": "civil", "groupe": "obj_activite",
                        "niveau": "site",
                        "mois": [], "ecrases": []}
    assert nb_periodes(db) == n


def test_repartition_annuelle_422_sans_rien_ecrire(make_client, db):
    c = make_client(ADMIN)
    sites, _ = ids(db)
    mauvais = [
        ("ca_marge", "global", [total("ca", "12")]),  # pas un groupe d'objectifs
        ("obj_activite", "global", [total("obj_ca", "12")]),  # indicateur d'un autre groupe
        ("obj_activite", "global", [total("obj_ventes", "-12")]),
        ("obj_activite", "global", [total("obj_ventes", "abc")]),
        ("obj_activite", "global", [total("obj_clients", "2,5")]),  # un nombre est entier
        ("obj_activite", "global", [total("obj_ventes", "1"), total("obj_ventes", "2")]),
        ("obj_activite", "site", [total("obj_ventes", "12")]),  # global dans un niveau site
        ("obj_activite", "inconnu", [total("obj_ventes", "12")]),
        ("obj_activite", "inconnu", []),  # niveau refusé même sans case
    ]
    for groupe, niveau, cases in mauvais:
        assert repartir(c, groupe, niveau, cases).status_code == 422, (groupe, niveau, cases)
    assert repartir(c, "obj_activite", "global", [total("obj_ventes", "12")],
                    annee=1999).status_code == 422
    assert repartir(make_client(), "obj_activite", "global",
                    [total("obj_ventes", "12")]).status_code == 401
    assert nb_lignes(db) == 0 and nb_periodes(db) == 0
    del sites


def test_repartition_annuelle_perimetre_restreint_sans_rien_ecrire(make_client, db, monkeypatch):
    c = make_client(ADMIN)
    sites, services = ids(db)
    d, y = sites["Douala"], sites["Yaoundé"]
    sav = services["SAV PL"]
    monkeypatch.setattr(pilotage, "scope_for", lambda _db, _p: RESTREINT)
    for niveau, cases in (("cellule", [total("obj_ventes", "12", d, sav),
                                       total("obj_ventes", "12", y, sav)]),
                          ("global", [total("obj_ventes", "12")])):
        assert repartir(c, "obj_activite", niveau, cases).status_code == 403
    assert nb_lignes(db) == 0 and nb_periodes(db) == 0
    r = repartir(c, "obj_activite", "cellule", [total("obj_ventes", "12", d, sav)])
    assert r.status_code == 200 and nb_lignes(db, "obj_ventes") == 12


def test_repartir_annee_fonction_pure():
    r = pilotage.repartir_annee(D("100"), False)
    assert r == [D(8)] * 11 + [D(12)]
    r = pilotage.repartir_annee(D("0.5"), False)
    assert sum(r) == D("0.5") and r[0] == D("0.0") and r[11] == D("0.5")
    assert pilotage.repartir_annee(D("-100"), False) == [D(-8)] * 11 + [D(-12)]
    assert pilotage.repartir_annee(D("7"), True) == [D(7)] * 12
    assert pilotage.repartir_annee(D("120"), False) == [D(10)] * 12


def test_repartition_annuelle_signale_les_lignes_d_un_autre_niveau(make_client, db):
    c = make_client(ADMIN)
    sites, _ = ids(db)
    saisir(c, "obj_activite", "site", [case(sites["Douala"], obj_ventes="5")], mois=3)
    r = repartir(c, "obj_activite", "global", [total("obj_ventes", "120")])
    assert r.status_code == 200, r.text
    assert r.json()["ecrases"] == [3]  # lignes du site effacées par le passage au global


def test_productivite_moyenne_sans_fin_ni_reste_a_repartir(make_client, db):
    c = make_client(ADMIN)
    sites, _ = ids(db)
    r = saisir(c, "obj_activite", "site", [case(sites["Douala"], obj_productivite="80"),
                                           case(sites["Yaoundé"], obj_productivite="85"),
                                           case(sites["Garoua"], obj_productivite="85")])
    assert r.status_code == 200, r.text
    j = lire(c, "obj_activite", niveau="global").json()
    # 250 / 3 ne tient pas dans une saisie : pas de proposition, ni de reste à répartir
    assert j["cases"][0]["valeurs"]["obj_productivite"]["propose"] is None
    assert "obj_productivite" not in j["a_repartir"]
    saisir(c, "obj_activite", "site", [case(sites["Garoua"], obj_productivite="90")])
    j = lire(c, "obj_activite", niveau="global").json()
    assert D(j["cases"][0]["valeurs"]["obj_productivite"]["propose"]) == 85
    assert "obj_productivite" not in j["a_repartir"]


def test_journal_masque_la_marge_sans_droit_marge(make_client, db):
    c = make_client(ADMIN)
    saisir(c, "obj_ca_marge", "global", [case(obj_ca="100", obj_marge="10")])
    saisir(c, "obj_activite", "global", [case(obj_ventes="4")])
    r = c.post(f"{API}/users", json={"email": "j@exemple.invalid", "nom": "J",
                                     "password": "<mot-de-passe-test>",
                                     "permissions": ["journal"], "portee": {"tout": True}})
    assert r.status_code == 201, r.text
    mot_de_passe_choisi(db, "j@exemple.invalid")
    j = make_client("j@exemple.invalid").get(f"{API}/audit").json()
    ev = {e["apres"]["groupe"]: e["apres"] for e in j if e["action"] == "saisie_pilotage"}
    assert ev["obj_ca_marge"]["valeurs"] is None
    assert ev["obj_activite"]["valeurs"] == {"obj_ventes//": "4.000"}
    adm = {e["apres"]["groupe"]: e["apres"] for e in c.get(f"{API}/audit").json()
           if e["action"] == "saisie_pilotage"}
    assert adm["obj_ca_marge"]["valeurs"]["obj_marge//"] == "10.000"


def test_objectif_de_marge_refuse_sans_objectif_de_ca(make_client, db):
    c = make_client(ADMIN)
    r = saisir(c, "obj_ca_marge", "global", [case(obj_marge="5")])
    assert r.status_code == 422 and r.json()["detail"] == pilotage.OBJ_MARGE_SANS_CA
    r = repartir(c, "obj_ca_marge", "global", [total("obj_marge", "120")])
    assert r.status_code == 422 and nb_lignes(db) == 0 and nb_periodes(db) == 0
    # objectif de CA déjà saisi sur le mois : la marge seule passe
    assert saisir(c, "obj_ca_marge", "global", [case(obj_ca="100")]).status_code == 200
    assert saisir(c, "obj_ca_marge", "global", [case(obj_marge="5")]).status_code == 200


def test_repartition_d_un_total_vide_efface_les_objectifs_des_12_mois(make_client, db):
    c = make_client(ADMIN)
    assert repartir(c, "obj_activite", "global", [total("obj_ventes", "120")]).status_code == 200
    assert nb_lignes(db, "obj_ventes") == 12
    r = repartir(c, "obj_activite", "global", [total("obj_ventes", None)])
    assert r.status_code == 200, r.text
    assert nb_lignes(db, "obj_ventes") == 0 and len(r.json()["ecrases"]) == 12


def test_repartition_vide_n_ouvre_aucun_mois(make_client, db):
    c = make_client(ADMIN)
    for cases in ([], [total("obj_ventes", "")]):
        r = repartir(c, "obj_activite", "global", cases)
        assert r.status_code == 200 and r.json()["mois"] == []
    assert nb_periodes(db) == 0


# ---------- conflit : la saisie la plus récente est retenue, le choix se fait en un clic ----------


def lignes_ca(ca_e1=500, br=1000, ca_e3=200):
    return [
        lig(**{BR: br, CA_INDIVIDUEL: ca_e1, MARGE_INDIVIDUELLE: 50}),
        lig(MATRICULE="E2", Noms="Bob", **{BR: 1000, CA_INDIVIDUEL: 300}),
        lig(MATRICULE="E3", Noms="Cy", Service="Commerce VN", Site="Yaoundé",
            **{BR: 500, CA_INDIVIDUEL: ca_e3, MARGE_INDIVIDUELLE: 20}),
    ]


def cellule_saisie(c, db, ca="1000"):
    """Employés importés puis CA saisi (1000 contre 800) sur Douala / SAV PL."""
    charger(c, lignes_ca())
    sites, services = ids(db)
    cell = (sites["Douala"], services["SAV PL"])
    assert saisir(c, "ca_marge", "cellule", [case(*cell, ca=ca)]).status_code == 200
    return cell


def chiffres(v):
    return {k: D(x) if k in ("saisi", "employes", "valeur", "ecart") and x is not None else x
            for k, x in v.items()}


def ca_de(c, cell):
    return chiffres(par_cle(lire(c, niveau="cellule").json())[cell]["ca"])


def trancher(c, cell, choix, indicateur="ca", **chiffres_vus):
    """Envoie les chiffres à l'écran, sauf `saisie` ou `employes` donnés (chiffres périmés)."""
    r = lire(c, niveau="cellule" if cell[0] else "global")
    v = par_cle(r.json()).get(cell, {}).get(indicateur, {}) if r.status_code == 200 else {}
    corps = {"saisie": v.get("saisi") or "0", "employes": v.get("employes") or "0", **chiffres_vus}
    return c.post(f"{URL}/conflit", json={**P, "site_id": cell[0], "service_id": cell[1],
                                          "indicateur": indicateur, "choix": choix, **corps})


def dates_employes(db):
    db.expire_all()
    return {(d.indicateur, d.site_id, d.service_id): d.modifie_le
            for d in db.scalars(select(DateEmployes))}


def test_saisie_apres_les_employes_retenue_avec_conflit(make_client, db):
    c = make_client(ADMIN)
    cell = cellule_saisie(c, db)
    v = ca_de(c, cell)
    assert (v["valeur"], v["origine"], v["conflit"]) == (D("1000"), "saisi", True)


def test_corriger_un_salaire_ne_date_pas_le_ca_des_employes(make_client, db):
    c = make_client(ADMIN)
    cell = cellule_saisie(c, db)
    avant = dates_employes(db)
    charger(c, lignes_ca(br=2000))
    assert dates_employes(db) == avant
    assert ca_de(c, cell)["valeur"] == D("1000")


def test_import_qui_change_le_ca_passe_devant_la_saisie_et_le_rapport_suit(make_client, db):
    c = make_client(ADMIN)
    cell = cellule_saisie(c, db)
    charger(c, lignes_ca(ca_e1=600))
    v = ca_de(c, cell)
    assert (v["saisi"], v["valeur"], v["origine"], v["conflit"]) == (
        D("1000"), D("900"), "calcule", True)
    assert charger_periode(db, RESTREINT, 2026, 1).ca == 900


def test_annuler_le_lot_date_le_retour_des_employes(make_client, db):
    c = make_client(ADMIN)
    cell = cellule_saisie(c, db)
    lot = envoyer(c, lignes_ca(ca_e1=600))
    assert c.post(f"{API}/imports/{lot['id']}/valider").status_code == 200
    assert c.post(f"{API}/imports/{lot['id']}/annuler").status_code == 200
    v = ca_de(c, cell)
    assert (v["employes"], v["valeur"], v["origine"], v["conflit"]) == (
        D("800"), D("800"), "calcule", True)


def test_reenregistrer_le_meme_chiffre_ne_change_pas_sa_date(make_client, db):
    c = make_client(ADMIN)
    cell = cellule_saisie(c, db)
    charger(c, lignes_ca(ca_e1=600))
    saisir(c, "ca_marge", "cellule", [case(*cell, ca="1000.000")])
    assert ca_de(c, cell)["valeur"] == D("900")
    saisir(c, "ca_marge", "cellule", [case(*cell, ca="1100")])
    v = ca_de(c, cell)
    assert (v["valeur"], v["origine"], v["conflit"]) == (D("1100"), "saisi", True)


def test_garder_la_saisie_regle_le_conflit_jusqu_au_prochain_changement(make_client, db):
    c = make_client(ADMIN)
    cell = cellule_saisie(c, db)
    charger(c, lignes_ca(ca_e1=600))
    r = trancher(c, cell, "saisie")
    assert r.status_code == 200
    v = chiffres(par_cle(r.json())[cell]["ca"])
    assert (v["valeur"], v["origine"], v["ecart"], v["conflit"]) == (
        D("1000"), "saisi", D("100"), False)
    assert trancher(c, cell, "saisie").status_code == 409
    charger(c, lignes_ca(ca_e1=800))
    v = ca_de(c, cell)
    assert (v["valeur"], v["origine"], v["conflit"]) == (D("1100"), "calcule", True)


def test_modifier_la_saisie_apres_garder_fait_revenir_le_conflit(make_client, db):
    c = make_client(ADMIN)
    cell = cellule_saisie(c, db)
    assert trancher(c, cell, "saisie").status_code == 200
    assert saisir(c, "ca_marge", "cellule", [case(*cell, ca="1200")]).status_code == 200
    v = ca_de(c, cell)
    assert (v["valeur"], v["origine"], v["conflit"]) == (D("1200"), "saisi", True)


def test_choix_sur_des_chiffres_perimes_refuse(make_client, db):
    c = make_client(ADMIN)
    cell = cellule_saisie(c, db)
    assert trancher(c, cell, "saisie", employes="799").status_code == 409
    assert trancher(c, cell, "employes", saisie="999").status_code == 409
    assert ca_de(c, cell)["conflit"] is True
    assert nb_lignes(db, "ca") == 1


def test_meme_chiffre_ecrit_autrement_n_est_pas_perime(make_client, db):
    c = make_client(ADMIN)
    cell = cellule_saisie(c, db)
    assert trancher(c, cell, "saisie", saisie="1000.000", employes="800.00").status_code == 200
    assert ca_de(c, cell)["conflit"] is False


def test_somme_globale_inchangee_ne_rouvre_pas_le_conflit_mais_date_les_cases(make_client, db):
    c = make_client(ADMIN)
    charger(c, lignes_ca())
    assert saisir(c, "ca_marge", "global", [case(ca="900")]).status_code == 200
    glob = (None, None)
    assert trancher(c, glob, "saisie").status_code == 200
    avant = dates_employes(db)
    charger(c, lignes_ca(ca_e1=400, ca_e3=300))  # 100 passent d'un site à l'autre, total 1000
    apres = dates_employes(db)
    assert apres[("ca", None, None)] == avant[("ca", None, None)]
    sites, services = ids(db)
    assert apres[("ca", sites["Douala"], None)] != avant[("ca", sites["Douala"], None)]
    assert apres[("ca", sites["Yaoundé"], services["Commerce VN"])] != avant[
        ("ca", sites["Yaoundé"], services["Commerce VN"])]
    v = chiffres(par_cle(lire(c, niveau="global").json())[glob]["ca"])
    assert (v["valeur"], v["origine"], v["conflit"]) == (D("900"), "saisi", False)


def test_donnees_anciennes_sans_date_employes_la_saisie_gagne_et_le_conflit_se_voit(make_client, db):
    c = make_client(ADMIN)
    cell = cellule_saisie(c, db)
    for d in db.scalars(select(DateEmployes)):
        db.delete(d)
    db.commit()
    v = ca_de(c, cell)
    assert (v["valeur"], v["origine"], v["conflit"]) == (D("1000"), "saisi", True)


def test_journal_masque_les_chiffres_du_conflit_sans_droit_marge(make_client, db):
    c = make_client(ADMIN)
    cell = cellule_saisie(c, db)
    assert trancher(c, cell, "saisie").status_code == 200
    r = c.post(f"{API}/users", json={"email": "j@exemple.invalid", "nom": "J",
                                     "password": "<mot-de-passe-test>",
                                     "permissions": ["journal"], "portee": {"tout": True}})
    assert r.status_code == 201, r.text
    mot_de_passe_choisi(db, "j@exemple.invalid")
    ev = next(e for e in make_client("j@exemple.invalid").get(f"{API}/audit").json()
              if e["action"] == "saisie_conflit")
    assert (ev["avant"]["saisie"], ev["avant"]["employes"]) == (None, None)
    assert ev["avant"]["indicateur"] == "ca"
    assert ev["apres"] == {"choix": "saisie"}
    adm = next(e for e in c.get(f"{API}/audit").json() if e["action"] == "saisie_conflit")
    assert D(adm["avant"]["saisie"]) == D("1000")


def test_regler_un_conflit_exige_le_droit_marge(make_client, db):
    c = make_client(ADMIN)
    cell = cellule_saisie(c, db)
    r = c.post(f"{API}/users", json={"email": "s@exemple.invalid", "nom": "S",
                                     "password": "<mot-de-passe-test>",
                                     "permissions": ["saisie"], "portee": {"tout": True}})
    assert r.status_code == 201, r.text
    mot_de_passe_choisi(db, "s@exemple.invalid")
    assert trancher(make_client("s@exemple.invalid"), cell, "saisie").status_code == 403
    assert ca_de(c, cell)["conflit"] is True


def test_prendre_les_employes_retire_la_saisie_et_trace_le_choix(make_client, db):
    c = make_client(ADMIN)
    cell = cellule_saisie(c, db)
    r = trancher(c, cell, "employes")
    assert r.status_code == 200
    v = chiffres(par_cle(r.json())[cell]["ca"])
    assert (v["saisi"], v["valeur"], v["origine"], v["conflit"]) == (
        None, D("800"), "calcule", False)
    assert nb_lignes(db, "ca") == 0
    ev = db.scalars(select(AuditEvent).where(AuditEvent.action == "saisie_conflit")).one()
    assert ev.apres == {"choix": "employes"}


def test_conflit_sans_conflit_hors_perimetre_et_sans_droit(make_client, db, monkeypatch):
    c = make_client(ADMIN)
    charger(c, lignes_ca())
    sites, services = ids(db)
    cell = (sites["Douala"], services["SAV PL"])
    assert trancher(c, cell, "saisie").status_code == 409  # rien de saisi
    autre = (sites["Yaoundé"], services["Commerce VN"])
    saisir(c, "ca_marge", "cellule", [case(*cell, ca="1000"), case(*autre, ca="999")])
    monkeypatch.setattr(pilotage, "scope_for", lambda _db, _p: RESTREINT)
    assert trancher(c, autre, "saisie").status_code == 403
    monkeypatch.undo()
    assert trancher(make_client(EQUIP), cell, "saisie").status_code == 403
    assert nb_lignes(db, "ca") == 2
