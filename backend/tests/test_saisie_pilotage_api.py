"""Saisies du mois à un seul niveau par groupe : CA et marge, OR, devis et factures
(GET et PUT /pilotage/saisies), niveau, droits, périmètre, audit, exactitude."""

from decimal import Decimal as D

import pytest
from sqlalchemy import func, select

from app.api import pilotage
from app.kpi.chargement import charger_periode, filtrer
from app.kpi.moteur import CA_INDIVIDUEL, MARGE_INDIVIDUELLE, Params, mensuel
from app.models.auth import AuditEvent
from app.models.donnees import Periode
from app.models.pilotage import ValeurSaisie
from app.models.referentiel import Service, Site
from app.repos.scope import Scope
from tests.test_donnees_activite import _sans_marge, charger, lig
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
                 "ecart": None, "propose": None}
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
