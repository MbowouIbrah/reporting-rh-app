"""Restitution des données d'activité : bloc ACTIVITÉ (mensuel, annuel, individuel), saisie de
l'OR, des devis et des factures, droits, périmètre et export."""

from decimal import Decimal as D
from io import BytesIO

import pytest
from fastapi import HTTPException
from openpyxl import load_workbook
from sqlalchemy import func, select

from app.api import pilotage
from app.kpi.chargement import filtrer
from app.kpi.moteur import (
    CA_INDIVIDUEL,
    CLIENTS,
    MARGE_INDIVIDUELLE,
    PRODUCTIVITE,
    VENTES,
    Budgets,
    Ligne,
    Params,
    PeriodeData,
    Saisie,
    _activite,
    annuel,
    mensuel,
)
from app.models.auth import AuditEvent
from app.models.donnees import Periode
from app.models.pilotage import ValeurSaisie
from app.models.referentiel import Service, Site
from app.repos.scope import Scope
from tests.test_donnees_activite import _sans_marge, charger, lig
from tests.test_donnees_api import ADMIN, API, BR, DRH
from tests.test_kpi_moteur import EXCL, REFS
from tests.test_rapports_api import EQUIP, get

# ---------- moteur ----------


def ligne(sid, service="SAV PL", site="Douala", productif=False, **ind):
    return Ligne(sid, service, site, "Front office", "CDI", {"Brut Réel": D(1000)},
                 "principal", None, {k: D(v) for k, v in ind.items()}, None, productif)


def saisie(indicateur, valeur, service="SAV PL", site="Douala", type_site="principal"):
    return Saisie(service, site, type_site, indicateur, D(valeur))


def pd(lignes=(), saisies=()):
    return PeriodeData(tuple(lignes), EXCL, saisies=tuple(saisies))


def test_activite_sommes_moyenne_et_ratios():
    p = pd([ligne(1, productif=True, **{VENTES: 3, CLIENTS: 2, PRODUCTIVITE: "1.5"}),
            ligne(2, productif=True, **{VENTES: 2, PRODUCTIVITE: 2}),
            ligne(3, service="Commerce VN")],
           [saisie("or", 100), saisie("or", "50.5", site="Yaoundé"), saisie("devis", 30),
            saisie("factures", 90)])
    a = _activite(p)
    assert a["ventes"] == 5 and a["clients"] == 2
    assert a["productivite"] == D("1.75")
    assert (a["or"], a["devis"], a["factures"]) == (D("150.5"), 30, 90)
    assert a["productifs"] == 2
    assert a["or_par_productif"] == D("75.25") and a["factures_par_productif"] == 45


def test_activite_sans_productif_ou_sans_donnee():
    a = _activite(pd([ligne(1)], [saisie("or", 10)]))
    assert a["productifs"] == 0 and a["or"] == 10
    assert a["or_par_productif"] is None and a["factures_par_productif"] is None
    vide = _activite(pd([ligne(1, productif=True)]))
    assert vide["ventes"] is None and vide["productivite"] is None and vide["or"] is None
    assert vide["productifs"] == 1 and vide["or_par_productif"] is None
    assert _activite(None)["productifs"] is None


def test_productivite_division_exacte():
    p = pd([ligne(1, **{PRODUCTIVITE: 1}), ligne(2, **{PRODUCTIVITE: 1}),
            ligne(3, **{PRODUCTIVITE: 2})])
    assert _activite(p)["productivite"] == D(4) / D(3)


# ---------- mensuel et annuel ----------


def test_mensuel_bloc_masque_sans_activite():
    r = mensuel(pd([ligne(1, productif=True)]), None, REFS, Params())
    assert r["activite"] is None


def test_mensuel_bloc_avec_m_et_m1():
    cur = pd([ligne(1, productif=True, **{VENTES: 4})], [saisie("or", 100)])
    prev = pd([ligne(1, productif=True, **{VENTES: 1})], [saisie("or", 40)])
    b = mensuel(cur, prev, REFS, Params())["activite"]
    assert [x["cle"] for x in b] == [
        "ventes", "clients", "productivite", "or", "devis", "factures", "productifs",
        "or_par_productif", "factures_par_productif"]
    assert [x["libelle"] for x in b][:4] == [
        "Nombre de ventes", "Nombre de clients", "Indice de productivité (moyenne)", "OR"]
    par = {x["cle"]: x for x in b}
    assert (par["ventes"]["m"], par["ventes"]["m1"], par["ventes"]["var"]) == (4, 1, 3)
    assert (par["or"]["m"], par["or"]["m1"]) == (100, 40)
    assert par["or_par_productif"]["m"] == 100 and par["or_par_productif"]["m1"] == 40
    assert par["clients"]["m"] is None


def test_mensuel_mois_precedent_avec_saisies_sans_paie():
    cur = pd([ligne(1, productif=True)], [saisie("or", 100)])
    prev = pd((), [saisie("or", 40)])
    par = {x["cle"]: x for x in mensuel(cur, prev, REFS, Params())["activite"]}
    assert par["or"]["m1"] == 40 and par["or"]["var"] == 60
    assert par["productifs"]["m1"] is None and par["or_par_productif"]["m1"] is None


def test_annuel_cumuls_moyenne_et_ratio_sur_effectif_moyen():
    n = {1: pd([ligne(1, productif=True, **{VENTES: 3, PRODUCTIVITE: 1}),
                ligne(2, productif=True, **{VENTES: 1})],
               [saisie("or", 100), saisie("factures", 10)]),
         2: pd([ligne(i, productif=True, **({PRODUCTIVITE: 4} if i == 1 else {}))
                for i in range(1, 5)], [saisie("or", 300)]),
         3: pd((), [saisie("or", 1000)]),  # saisie sans paie : cumulée, effectif inchangé
         4: pd([ligne(1, productif=True)], [saisie("or", 5000)])}  # après le mois choisi
    b = annuel(n, {}, 3, REFS, Params())["activite"]
    par = {x["cle"]: x for x in b}
    assert par["ventes"]["m"] == 4 and par["clients"]["m"] is None
    assert par["productivite"]["m"] == D("2.5")
    assert par["or"]["m"] == 1400 and par["factures"]["m"] == 10 and par["devis"]["m"] is None
    assert par["productifs"]["m"] == 3  # (2 + 4) / 2 mois de paie
    assert par["or_par_productif"]["m"] == D(1400) / D(3)
    assert par["factures_par_productif"]["m"] == D(10) / D(3)
    assert par["or"]["m1"] is None


def test_annuel_n1_et_serie_et_bloc_masque():
    n = {1: pd([ligne(1, productif=True)], [saisie("or", 100)])}
    n1 = {1: pd([ligne(1, productif=True)], [saisie("or", 50)]),
          2: pd([ligne(1, productif=True)], [saisie("or", 70)])}
    r = annuel(n, n1, 1, REFS, Params())
    par = {x["cle"]: x for x in r["activite"]}
    assert (par["or"]["m"], par["or"]["m1"]) == (100, 50)
    assert r["serie_n"][0]["activite"]["or"] == 100 and r["serie_n"][1]["activite"]["or"] is None
    assert r["serie_n1"][1]["activite"]["or"] == 70
    sans = annuel({1: pd([ligne(1)])}, {}, 1, REFS, Params())
    assert sans["activite"] is None


def test_total_de_paie_inchange_par_les_donnees_d_activite():
    seul = pd([ligne(1, productif=True), ligne(2)])
    riche = pd([ligne(1, productif=True, **{VENTES: 9, CA_INDIVIDUEL: 500}),
                ligne(2, **{CLIENTS: 3})], [saisie("or", 100), saisie("devis", 7)])
    a, b = (mensuel(x, None, REFS, Params(), Budgets()) for x in (seul, riche))
    for cle in ("synthese", "a_type_charge", "b_service_activite", "c_site", "controles"):
        assert a[cle] == b[cle]
    assert a["activite"] is None and b["activite"] is not None
    n, m = annuel({1: seul}, {}, 1, REFS, Params()), annuel({1: riche}, {}, 1, REFS, Params())
    assert n["cumul_ytd"] == m["cumul_ytd"] and n["a_type_charge"] == m["a_type_charge"]


# ---------- filtre ----------


def test_filtre_des_saisies():
    p = pd([ligne(1)],
           [saisie("or", 1), saisie("or", 2, site="Yaoundé"),
            saisie("or", 4, service="Commerce VN", site="Yaoundé", type_site="agence")])
    assert len(filtrer(p, None, None).saisies) == 3
    assert [s.valeur for s in filtrer(p, None, "Douala").saisies] == [1]
    assert [s.valeur for s in filtrer(p, "Commerce VN", None).saisies] == [4]
    assert [s.valeur for s in filtrer(p, None, None, type_site="agence").saisies] == [4]
    for crit in ({"poste": "P"}, {"activite": "Front office"}, {"type_contrat": "CDI"},
                 {"salarie_id": 1}):
        assert filtrer(p, None, None, **crit).saisies == ()


# ---------- API ----------

PILOTAGE = f"{API}/pilotage/saisies"
P26 = {"annee": 2026, "mois": 1}
LECT = {**P26, "groupe": "activite"}


def ids(db):
    sites = {s.libelle: s.id for s in db.scalars(select(Site))}
    services = {s.libelle: s.id for s in db.scalars(select(Service))}
    return sites, services


def put(c, lignes, **kw):
    """Saisie d'activité au niveau cellule : une ligne = un indicateur d'un couple site/service."""
    cases: list[dict] = []
    for x in lignes:
        cle = (x["site_id"], x["service_id"])
        cible = next((k for k in cases if (k["site_id"], k["service_id"]) == cle
                      and x["indicateur"] not in k["valeurs"]), None)
        if cible is None:
            cible = {"site_id": cle[0], "service_id": cle[1], "valeurs": {}}
            cases.append(cible)
        cible["valeurs"][x["indicateur"]] = x["valeur"]
    return c.put(PILOTAGE, json={**P26, **kw, "groupe": "activite", "niveau": "cellule",
                                 "cases": cases})


def valeurs(j):
    """Valeurs renseignées d'une réponse de saisie : (site, service, indicateur) -> valeur."""
    return {(x["site_id"], x["service_id"], i): v["valeur"] for x in j["cases"]
            for i, v in x["valeurs"].items() if v["valeur"] is not None}


def ln(db, site, service, indicateur, valeur):
    sites, services = ids(db)
    return {"site_id": sites[site], "service_id": services[service], "indicateur": indicateur,
            "valeur": valeur}


def nb_saisies(db):
    return db.scalar(select(func.count()).select_from(ValeurSaisie))


def nb_periodes(db):
    return db.scalar(select(func.count()).select_from(Periode))


def test_saisie_ecriture_lecture_et_suppression(make_client, db):
    c = make_client(ADMIN)
    charger(c, [lig(**{BR: 1000})])
    r = put(c, [ln(db, "Douala", "SAV PL", "or", "100,5"),
                ln(db, "Douala", "SAV PL", "devis", "20"),
                ln(db, "Yaoundé", "Commerce VN", "factures", "3.1234567")])
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["annee"] == 2026 and j["mois"] == 1 and j["periode_id"] is not None
    sites, services = ids(db)
    assert {x["libelle"] for x in j["sites"]} >= {"Douala", "Yaoundé"}
    sav = next(x for x in j["services"] if x["libelle"] == "SAV PL")
    assert sav["productif"] is True
    assert next(x for x in j["services"] if x["libelle"] == "Commerce VN")["productif"] is False
    vals = valeurs(j)
    assert vals[(sites["Douala"], services["SAV PL"], "or")] == "100.500"
    assert vals[(sites["Douala"], services["SAV PL"], "devis")] == "20.000"
    assert vals[(sites["Yaoundé"], services["Commerce VN"], "factures")] == "3.1234567"
    assert c.get(PILOTAGE, params=LECT).json() == j
    actions = db.scalars(select(AuditEvent.action).order_by(AuditEvent.id)).all()
    assert actions[-1] == "saisie_pilotage"

    # valeur modifiée, puis effacée par une valeur vide ou absente
    j = put(c, [ln(db, "Douala", "SAV PL", "or", "7"),
                ln(db, "Douala", "SAV PL", "devis", ""),
                ln(db, "Yaoundé", "Commerce VN", "factures", None)]).json()
    assert list(valeurs(j).items()) == [((sites["Douala"], services["SAV PL"], "or"), "7.000")]
    assert nb_saisies(db) == 1
    # un envoi sans changement ne laisse pas de trace de plus
    n = db.scalar(select(func.count()).select_from(AuditEvent))
    put(c, [ln(db, "Douala", "SAV PL", "or", "7")])
    assert db.scalar(select(func.count()).select_from(AuditEvent)) == n


def test_saisie_validation_422_sans_rien_ecrire(make_client, db):
    c = make_client(ADMIN)
    bonne = ln(db, "Douala", "SAV PL", "or", "10")
    for mauvaise in (ln(db, "Douala", "SAV PL", "ventes", "1"),
                     ln(db, "Douala", "SAV PL", "devis", "-1"),
                     ln(db, "Douala", "SAV PL", "devis", "abc"),
                     ln(db, "Douala", "SAV PL", "devis", "1e5"),
                     ln(db, "Douala", "SAV PL", "devis", "NaN"),
                     {**ln(db, "Douala", "SAV PL", "devis", "1"), "site_id": 99999},
                     {**ln(db, "Douala", "SAV PL", "devis", "1"), "service_id": 99999}):
        r = put(c, [bonne, mauvaise])
        assert r.status_code == 422, (mauvaise, r.text)
    assert put(c, [bonne, bonne]).status_code == 422  # doublon
    assert nb_saisies(db) == 0 and nb_periodes(db) == 0


def test_saisie_lecture_ne_cree_pas_de_periode(make_client, db):
    c = make_client(ADMIN)
    j = c.get(PILOTAGE, params={"annee": 2026, "mois": 7, "groupe": "activite"}).json()
    assert j["periode_id"] is None and valeurs(j) == {} and j["sites"] and j["services"]
    assert nb_periodes(db) == 0
    # tout vide : le mois n'est pas ouvert
    r = put(c, [ln(db, "Douala", "SAV PL", "or", ""), ln(db, "Douala", "SAV PL", "devis", None)])
    assert r.status_code == 200 and r.json()["periode_id"] is None and nb_periodes(db) == 0
    # une vraie valeur ouvre le mois
    r = put(c, [ln(db, "Douala", "SAV PL", "or", "1")])
    assert r.json()["periode_id"] is not None and nb_periodes(db) == 1


def test_saisie_droits(make_client, db):
    ligne_ok = ln(db, "Douala", "SAV PL", "or", "10")
    for who in (DRH, EQUIP):
        c = make_client(who)
        assert put(c, [ligne_ok]).status_code == 403
        assert c.get(PILOTAGE, params=LECT).status_code == 403  # lecture = droit d'import
    assert make_client().get(PILOTAGE, params=LECT).status_code == 401
    assert nb_saisies(db) == 0 and nb_periodes(db) == 0


RESTREINT = Scope(False, {"site": frozenset({"Douala"}), "service": frozenset({"SAV PL"})})


def test_saisie_hors_perimetre_403_et_lecture_restreinte(make_client, db, monkeypatch):
    c = make_client(ADMIN)
    assert put(c, [ln(db, "Douala", "SAV PL", "or", "1"), ln(db, "Yaoundé", "SAV PL", "or", "2"),
                   ln(db, "Douala", "Commerce VN", "or", "4")]).status_code == 200
    avant = nb_saisies(db)

    monkeypatch.setattr(pilotage, "scope_for", lambda _db, _p: RESTREINT)
    for hors in (ln(db, "Yaoundé", "SAV PL", "or", "9"), ln(db, "Douala", "Commerce VN", "or", "9"),
                 ln(db, "Yaoundé", "Commerce VN", "or", "")):
        r = put(c, [ln(db, "Douala", "SAV PL", "devis", "5"), hors])
        assert r.status_code == 403, r.text
    assert nb_saisies(db) == avant

    j = c.get(PILOTAGE, params=LECT).json()
    assert [x["libelle"] for x in j["sites"]] == ["Douala"]
    assert [x["libelle"] for x in j["services"]] == ["SAV PL"]
    assert list(valeurs(j).values()) == ["1.000"]
    # dans le périmètre : écriture permise, les valeurs hors périmètre restent intactes
    r = put(c, [ln(db, "Douala", "SAV PL", "devis", "5")])
    assert r.status_code == 200 and nb_saisies(db) == avant + 1

    monkeypatch.setattr(pilotage, "scope_for", lambda _db, _p: Scope(False, {}))
    assert put(c, [ln(db, "Douala", "SAV PL", "devis", "6")]).status_code == 403
    assert c.get(PILOTAGE, params=LECT).json()["sites"] == []


def test_saisies_restreintes_au_perimetre_a_la_lecture_des_rapports(make_client, db):
    from app.kpi.chargement import charger_periode

    c = make_client(ADMIN)
    charger(c, [lig(**{BR: 1000})])
    put(c, [ln(db, "Douala", "SAV PL", "or", "1"), ln(db, "Yaoundé", "SAV PL", "or", "2"),
            ln(db, "Douala", "Commerce VN", "or", "4")])
    tout = charger_periode(db, Scope(True, {}), 2026, 1)
    assert sorted(s.valeur for s in tout.saisies) == [1, 2, 4]
    dedans = charger_periode(db, RESTREINT, 2026, 1)
    assert [s.valeur for s in dedans.saisies] == [1]
    assert charger_periode(db, Scope(False, {}), 2026, 1).saisies == ()


# ---------- rapports ----------


def charger_activite(c):
    charger(c, [
        lig(**{BR: 1000, VENTES: 3, PRODUCTIVITE: "1.5", CLIENTS: 2, CA_INDIVIDUEL: 500,
               MARGE_INDIVIDUELLE: 50}),
        lig(MATRICULE="E2", Noms="Bob", **{BR: 2000, VENTES: 2, PRODUCTIVITE: 2,
                                           CA_INDIVIDUEL: 300, MARGE_INDIVIDUELLE: 20}),
        lig(MATRICULE="E3", Noms="Cy", Service="Commerce VN", Site="Yaoundé", **{BR: 500}),
    ])


def test_api_mensuel_bloc_activite(make_client, db):
    c = make_client(ADMIN)
    charger_activite(c)
    assert get(c, "mensuel", annee=2026, mois=1).json()["activite"] is not None  # via l'import
    put(c, [ln(db, "Douala", "SAV PL", "or", "100"), ln(db, "Douala", "SAV PL", "factures", "90"),
            ln(db, "Yaoundé", "Commerce VN", "or", "50.5")])
    par = {x["cle"]: x for x in get(c, "mensuel", annee=2026, mois=1).json()["activite"]}
    assert D(par["ventes"]["m"]) == 5 and D(par["productivite"]["m"]) == D("1.75")
    assert D(par["or"]["m"]) == D("150.5") and par["devis"]["m"] is None
    assert D(par["productifs"]["m"]) == 2
    assert D(par["or_par_productif"]["m"]) == D("75.25")
    assert D(par["factures_par_productif"]["m"]) == 45
    assert par["or"]["m1"] is None
    # un filtre poste n'a plus de saisie : OR absent, mais les ventes restent
    f = get(c, "mensuel", annee=2026, mois=1, poste="P").json()["activite"]
    assert {x["cle"]: x for x in f}["or"]["m"] is None
    # total de paie inchangé par les saisies
    avant = get(c, "mensuel", annee=2026, mois=1).json()
    put(c, [ln(db, "Douala", "SAV PL", "or", "999999")])
    apres = get(c, "mensuel", annee=2026, mois=1).json()
    assert avant["synthese"]["ms"] == apres["synthese"]["ms"]
    assert avant["a_type_charge"] == apres["a_type_charge"]
    # ventes et clients sans droit marge : toujours là
    _sans_marge(db)
    sans = get(c, "mensuel", annee=2026, mois=1).json()["activite"]
    assert {x["cle"] for x in sans} >= {"ventes", "or"}


def test_api_mensuel_mois_precedent_avec_saisies_sans_paie(make_client, db):
    c = make_client(ADMIN)
    assert put(c, [ln(db, "Douala", "SAV PL", "or", "40")], mois=1).status_code == 200
    charger(c, [lig(MOIS="Février", **{BR: 1000}), ])
    put(c, [ln(db, "Douala", "SAV PL", "or", "100")], mois=2)
    par = {x["cle"]: x for x in get(c, "mensuel", annee=2026, mois=2).json()["activite"]}
    assert D(par["or"]["m"]) == 100 and D(par["or"]["m1"]) == 40
    assert par["productifs"]["m1"] is None


def test_api_annuel_bloc_activite(make_client, db):
    c = make_client(ADMIN)
    charger_activite(c)
    put(c, [ln(db, "Douala", "SAV PL", "or", "100")])
    r = get(c, "annuel", annee=2026, mois=1).json()
    par = {x["cle"]: x for x in r["activite"]}
    assert D(par["or"]["m"]) == 100 and D(par["productifs"]["m"]) == 2
    assert D(par["or_par_productif"]["m"]) == 50
    assert r["serie_n"][0]["activite"]["or"] in ("100", "100.000")
    assert r["serie_n"][5]["activite"]["or"] is None


def test_individuel_ca_et_marge_masques_sans_droit_marge(make_client, db):
    c = make_client(ADMIN)
    charger_activite(c)
    j = get(c, "individuel", annee=2026, matricule="E1").json()
    a = j["mois"][0]["activite"]
    assert D(a["ventes"]) == 3 and D(a["productivite"]) == D("1.5")
    assert D(a["ca_individuel"]) == 500 and D(a["marge_individuelle"]) == 50
    assert j["mois"][1]["activite"] is None and j["mois"][0]["reference"] is None
    tot = j["activite_total"]  # totaux de l'année calculés par le serveur
    assert D(tot["ventes"]) == 3 and D(tot["productivite"]) == D("1.5")
    assert D(tot["ca_individuel"]) == 500
    t = get(c, "individuel/tous", annee=2026).json()["mois"][0]["activite"]
    assert D(t["ventes"]) == 5 and D(t["clients"]) == 2 and D(t["productivite"]) == D("1.75")
    assert D(t["ca_individuel"]) == 800 and D(t["marge_individuelle"]) == 70
    tt = get(c, "individuel/tous", annee=2026).json()["activite_total"]
    assert D(tt["ventes"]) == 5 and D(tt["productivite"]) == D("1.75")

    _sans_marge(db)
    a = get(c, "individuel", annee=2026, matricule="E1").json()["mois"][0]["activite"]
    assert D(a["ventes"]) == 3 and D(a["productivite"]) == D("1.5")
    assert "ca_individuel" not in a and "marge_individuelle" not in a
    tot = get(c, "individuel", annee=2026, matricule="E1").json()["activite_total"]
    assert D(tot["ventes"]) == 3 and "ca_individuel" not in tot
    t = get(c, "individuel/tous", annee=2026).json()["mois"][0]["activite"]
    assert D(t["ventes"]) == 5
    assert "ca_individuel" not in t and "marge_individuelle" not in t
    tt = get(c, "individuel/tous", annee=2026).json()["activite_total"]
    assert D(tt["ventes"]) == 5 and "ca_individuel" not in tt


def test_individuel_tous_aucune_valeur_renseignee(make_client):
    c = make_client(ADMIN)
    charger(c, [lig(**{BR: 1000})])
    t = get(c, "individuel/tous", annee=2026).json()["mois"][0]["activite"]
    assert t == {"ventes": None, "clients": None, "productivite": None,
                 "ca_individuel": None, "marge_individuelle": None}


def feuilles(r):
    assert r.status_code == 200, r.text
    return load_workbook(BytesIO(r.content))


def test_export_mensuel_feuille_activite(make_client, db):
    c = make_client(ADMIN)
    charger(c, [lig(**{BR: 1000})])
    assert "6 Activité" not in feuilles(get(c, "mensuel/export", annee=2026, mois=1)).sheetnames
    put(c, [ln(db, "Douala", "SAV PL", "or", "100")])
    wb = feuilles(get(c, "mensuel/export", annee=2026, mois=1))
    assert "6 Activité" in wb.sheetnames
    rows = list(wb["6 Activité"].values)
    assert rows[0][0] == "Indicateur" and rows[0][3:] == ("Variation", "Var. %")
    assert [r[0] for r in rows[1:]][:3] == [
        "Nombre de ventes", "Nombre de clients", "Indice de productivité (moyenne)"]
    assert next(r for r in rows if r[0] == "OR")[2] == 100
    assert "6 Activité" in feuilles(get(c, "annuel/export", annee=2026, mois=1)).sheetnames


def test_pytest_import_garde():
    with pytest.raises(HTTPException):
        pilotage._valeur_activite("-1")
    assert pilotage._valeur_activite(" 1,50 ") == D("1.50")
    assert pilotage._valeur_activite("") is None
