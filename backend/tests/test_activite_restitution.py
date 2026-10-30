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
    ABSENCES,
    CA_INDIVIDUEL,
    CLIENTS,
    COMMISSION,
    FRAIS_MISSION,
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
from app.models.referentiel import Rubrique, Service, Site
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


# ---------- objectifs ----------


def ligne_paie(sid, service="SAV PL", site="Douala", productif=False, **montants):
    m = {"Brut Réel": D(1000), **{k.replace("_", " "): D(v) for k, v in montants.items()}}
    return Ligne(sid, service, site, "Front office", "CDI", m, "principal", None, {}, None,
                 productif)


def periode(lignes=(), saisies=(), vides=(), ca=None, marge=None):
    return PeriodeData(tuple(lignes), EXCL, ca=None if ca is None else D(ca),
                       marge=None if marge is None else D(marge), saisies=tuple(saisies),
                       vides=tuple(vides))


def objectif(indicateur, valeur, site=None, service=None):
    return Saisie(service, site, None, indicateur, None if valeur is None else D(valeur))


def test_mensuel_objectifs_de_ca_marge_et_d_activite():
    cur = periode(
        [ligne(1, productif=True, **{VENTES: 3, CLIENTS: 2, PRODUCTIVITE: 2}),
         ligne(2, productif=True, **{VENTES: 2, PRODUCTIVITE: 4})],
        [saisie("factures", 90), objectif("obj_ventes", 4), objectif("obj_ventes", 6, "Yaoundé"),
         objectif("obj_productivite", 3), objectif("obj_productivite", 5, "Yaoundé"),
         objectif("obj_clients", 2), objectif("obj_factures", 100), objectif("obj_ca", 800),
         objectif("obj_marge", 120)], ca=1000, marge=100)
    r = mensuel(cur, None, REFS, Params())
    o = r["objectifs"]
    assert (o["ventes"], o["productivite"], o["clients"], o["factures"]) == (10, 4, 2, 100)
    assert (o["ca"], o["marge"]) == (800, 120)
    assert o["ms"] == Params().budget_employe * 2
    par = {x["cle"]: x for x in r["activite"]}
    assert (par["ventes"]["budget"], par["ventes"]["ecart"]) == (10, -5)
    assert (par["productivite"]["budget"], par["productivite"]["ecart"]) == (4, -1)
    assert (par["clients"]["budget"], par["factures"]["budget"]) == (2, 100)
    assert par["factures"]["ecart"] == -10 and par["factures"]["ecart_pct"] == D("-0.1")
    assert "budget" not in par["or"] and "budget" not in par["productifs"]
    ca, marge = r["lignes_ca_marge"]["ca"], r["lignes_ca_marge"]["marge"]
    assert (ca["budget"], ca["ecart"], ca["ecart_pct"]) == (800, 200, D("0.25"))
    assert (marge["budget"], marge["ecart"]) == (120, -20)
    assert not r["budget_partiel"]


def test_mensuel_sans_objectif_aucun_budget_sur_les_lignes():
    r = mensuel(periode([ligne(1, productif=True, **{VENTES: 3})], ca=10, marge=1), None, REFS,
                Params())
    assert all(r["objectifs"][k] is None for k in (
        "ca", "marge", "ventes", "clients", "factures", "productivite", "frais_mission",
        "commissions", "remuneration"))
    par = {x["cle"]: x for x in r["activite"]}
    assert par["ventes"]["budget"] is None and par["ventes"]["ecart"] is None
    assert r["lignes_ca_marge"]["ca"]["budget"] is None
    assert r["frais_mission"]["budget"] is None


def test_objectif_vide_ne_rend_pas_le_reel_partiel_et_inversement():
    base = [ligne(1, productif=True, **{VENTES: 3})]
    # case d'objectif attendue mais vide, aucun objectif de ce type saisi : rien de partiel
    cur = periode(base, [saisie("factures", 90)], [objectif("obj_factures", None, "Yaoundé")],
                  ca=10)
    r = mensuel(cur, None, REFS, Params())
    par = {x["cle"]: x for x in r["activite"]}
    assert "partiel" not in par["factures"] and "budget_partiel" not in par["factures"]
    assert not r["budget_partiel"] and par["factures"]["budget"] is None
    # un objectif saisi et une case d'objectif vide : l'objectif est partiel, pas le réel
    cur = periode(base, [saisie("factures", 90), objectif("obj_factures", 100)],
                  [objectif("obj_factures", None, "Yaoundé")])
    r = mensuel(cur, None, REFS, Params())
    par = {x["cle"]: x for x in r["activite"]}
    assert par["factures"]["budget"] == 100 and par["factures"]["budget_partiel"] is True
    assert "partiel" not in par["factures"] and r["budget_partiel"] is True
    assert "budget_partiel" not in par["ventes"]
    # le réel partiel n'entraîne pas l'objectif
    cur = periode(base, [saisie("factures", 90), objectif("obj_factures", 100)],
                  [objectif("factures", None, "Yaoundé")])
    par = {x["cle"]: x for x in mensuel(cur, None, REFS, Params())["activite"]}
    assert par["factures"]["partiel"] is True and "budget_partiel" not in par["factures"]


def test_objectifs_de_ca_marge_hors_du_drapeau_budget_partiel():
    """L'état partiel des objectifs CA et marge n'est pas exposé hors droit marge."""
    cur = periode([ligne(1)], [objectif("obj_ca", 5)], [objectif("obj_ca", None, "Yaoundé")],
                  ca=10)
    r = mensuel(cur, None, REFS, Params())
    assert r["lignes_ca_marge"]["ca"]["budget_partiel"] is True and not r["budget_partiel"]


def test_budget_ms_f2_et_totaux_inchanges_par_les_objectifs():
    seul = periode([ligne_paie(1, productif=True), ligne_paie(2)])
    riche = periode([ligne_paie(1, productif=True), ligne_paie(2)],
                    [objectif("obj_ventes", 5), objectif("obj_ca", 9), objectif("obj_marge", 1)])
    p = Params(budget_employe=D(700))
    bud = Budgets(rubrique={"Frais de mission": D(50), "Commission": D(20)})
    a, b = (mensuel(x, None, REFS, p, bud) for x in (seul, riche))
    for cle in ("synthese", "a_type_charge", "b_service_activite", "c_site", "controles"):
        assert a[cle] == b[cle]
    assert a["objectifs"]["ms"] == b["objectifs"]["ms"] == D(1400)  # budget par employé x effectif


def test_mensuel_frais_mission_a_part_dans_le_total_avec_son_budget():
    sans = periode([ligne_paie(1), ligne_paie(2)])
    avec = periode([ligne_paie(1, Frais_de_mission=300), ligne_paie(2)])
    bud = Budgets(rubrique={FRAIS_MISSION: D(250), COMMISSION: D(100), ABSENCES: D(7)})
    r = mensuel(avec, None, REFS, Params(), bud)
    fm = r["frais_mission"]
    assert (fm["m"], fm["budget"], fm["ecart"], fm["ecart_pct"]) == (300, 250, 50, D("0.2"))
    assert fm["m1"] is None
    o = r["objectifs"]
    assert (o["frais_mission"], o["commissions"]) == (250, 100)
    assert o["remuneration"] == 350  # somme des budgets de rubrique, hors absences
    # la ligne n'ajoute rien : le total de paie contient déjà les frais de mission
    ms_sans = mensuel(sans, None, REFS, Params(), bud)["synthese"]
    assert mensuel(avec, None, REFS, Params(), bud)["synthese"] != ms_sans  # 300 de plus
    assert avec.ms - sans.ms == 300
    prec = mensuel(avec, periode([ligne_paie(1, Frais_de_mission=100)]), REFS, Params())
    assert (prec["frais_mission"]["m1"], prec["frais_mission"]["var"]) == (100, 200)


def test_annuel_objectifs_cumules_sur_les_memes_mois_que_le_reel():
    n = {1: periode([ligne(1, productif=True, **{VENTES: 3, PRODUCTIVITE: 2})],
                    [objectif("obj_ventes", 4), objectif("obj_productivite", 3),
                     objectif("obj_ca", 80)], ca=100, marge=10),
         2: periode((), [objectif("obj_ventes", 50), objectif("obj_ca", 50)]),  # sans réel
         3: periode([ligne(1, productif=True, **{VENTES: 5, PRODUCTIVITE: 4})],
                    [objectif("obj_ventes", 6), objectif("obj_productivite", 5),
                     objectif("obj_ca", 150), objectif("obj_marge", 30)], ca=200, marge=40),
         4: periode([ligne(1, productif=True, **{VENTES: 9})],
                    [objectif("obj_ventes", 900), objectif("obj_ca", 900)], ca=999)}
    budgets = {1: Budgets(rubrique={FRAIS_MISSION: D(10)}),
               3: Budgets(rubrique={FRAIS_MISSION: D(15)})}
    r = annuel(n, {}, 3, REFS, Params(), budgets, {})
    par = {x["cle"]: x for x in r["activite"]}
    assert par["ventes"]["m"] == 8 and par["ventes"]["budget"] == 10  # mois 1 et 3 seulement
    assert par["productivite"]["m"] == 3 and par["productivite"]["budget"] == 4  # moyenne
    ca, marge = r["lignes_ca_marge"]["ca"], r["lignes_ca_marge"]["marge"]
    assert (ca["m"], ca["budget"], ca["ecart"]) == (300, 230, 70)
    assert (marge["m"], marge["budget"]) == (50, 30)  # le mois 1 n'a pas d'objectif de marge
    assert r["frais_mission"]["budget"] == 25
    assert r["serie_n"][0]["objectifs"]["ventes"] == 4
    assert r["serie_n"][1]["objectifs"]["ventes"] == 50 and r["serie_n"][1]["objectifs"]["ms"] is None
    assert r["serie_n"][0]["objectifs"]["frais_mission"] == 10
    assert r["serie_n"][4]["objectifs"]["ventes"] is None
    assert all("objectifs" not in s for s in r["serie_n1"])
    assert not r["budget_partiel"]


def test_annuel_objectif_partiel_signale_sans_toucher_au_reel():
    n = {1: periode([ligne(1, productif=True, **{VENTES: 3})],
                    [objectif("obj_ventes", 4)], [objectif("obj_ventes", None, "Yaoundé")])}
    r = annuel(n, {}, 1, REFS, Params())
    par = {x["cle"]: x for x in r["activite"]}
    assert par["ventes"]["budget_partiel"] is True and "partiel" not in par["ventes"]
    assert r["budget_partiel"] is True


def test_annuel_nouvelles_rubriques_en_serie_sans_objectif():
    n = {1: periode([ligne_paie(1, Assurance_Maladie=40, Formation=30,
                                Carburant_véhicule_service=20, Crédit_téléphonique=10)])}
    n1 = {1: periode([ligne_paie(1, Assurance_Maladie=4)])}
    r = annuel(n, n1, 1, REFS, Params())
    s = r["serie_n"][0]
    assert (s["assurance"], s["formation"], s["carburant"], s["credit_telephonique"]) == (
        40, 30, 20, 10)
    assert r["serie_n"][1]["assurance"] is None
    assert r["serie_n1"][0]["assurance"] == 4 and r["serie_n1"][0]["formation"] == 0
    assert set(s["objectifs"]) >= {"ms", "frais_mission", "commissions", "remuneration"}
    assert "assurance" not in s["objectifs"]  # ces rubriques n'ont pas d'objectif


# ---------- objectifs : API ----------

PIL = f"{API}/pilotage"


def saisir_obj(c, groupe, niveau, cases):
    r = c.put(PILOTAGE, json={**P26, "groupe": groupe, "niveau": niveau, "cases": cases})
    assert r.status_code == 200, r.text


def objectifs_charges(c, db):
    """Réel (ca_marge + paie), objectifs d'activité et de CA/marge, budget de frais de mission."""
    charger_activite(c)
    saisir_obj(c, "ca_marge", "global", [{"valeurs": {"ca": "1000", "marge": "100"}}])
    saisir_obj(c, "obj_ca_marge", "global", [{"valeurs": {"obj_ca": "912.5", "obj_marge": "157.5"}}])
    saisir_obj(c, "obj_activite", "global", [{"valeurs": {
        "obj_ventes": "10", "obj_clients": "3", "obj_productivite": "2", "obj_factures": "70"}}])
    rid = db.scalar(select(Rubrique.id).where(Rubrique.libelle == "Frais de mission"))
    r = c.put(f"{PIL}/budgets", json={**P26, "lignes": [
        {"axe": "rubrique", "cible_id": rid, "valeur": "123"}]})
    assert r.status_code == 200, r.text


def test_api_mensuel_objectifs(make_client, db):
    c = make_client(ADMIN)
    objectifs_charges(c, db)
    j = get(c, "mensuel", annee=2026, mois=1).json()
    o = j["objectifs"]
    assert (D(o["ca"]), D(o["marge"]), D(o["ventes"]), D(o["clients"])) == (D("912.5"), D("157.5"), 10, 3)
    assert (D(o["productivite"]), D(o["factures"]), D(o["frais_mission"])) == (2, 70, 123)
    assert D(o["ms"]) == 600000 * 3
    assert D(j["lignes_ca_marge"]["ca"]["budget"]) == D("912.5")
    assert D(j["lignes_ca_marge"]["ca"]["ecart"]) == D("87.5")
    par = {x["cle"]: x for x in j["activite"]}
    assert D(par["ventes"]["budget"]) == 10 and D(par["ventes"]["ecart"]) == -5
    assert D(par["productivite"]["budget"]) == 2
    assert D(j["frais_mission"]["budget"]) == 123 and j["budget_partiel"] is False


def test_api_mensuel_objectif_global_masque_par_un_filtre_de_perimetre(make_client, db):
    c = make_client(ADMIN)
    objectifs_charges(c, db)
    for filtre in ({"site": "Douala"}, {"service": "SAV PL"}, {"type_site": "principal"}):
        j = get(c, "mensuel", annee=2026, mois=1, **filtre).json()
        o = j["objectifs"]
        assert all(o[k] is None for k in ("ca", "marge", "ventes", "clients", "factures",
                                          "productivite")), filtre
        assert j["lignes_ca_marge"]["ca"]["budget"] is None
        assert o["frais_mission"] is None and o["remuneration"] is None  # budgets de rubrique
        assert o["ms"] is not None  # budget par employé x effectif : suit le filtre
        par = {x["cle"]: x for x in j["activite"]}
        assert par["ventes"]["budget"] is None
    # un objectif saisi par site répond au filtre de ce site
    sites, _ = ids(db)
    saisir_obj(c, "obj_activite", "site", [{"site_id": sites["Douala"],
                                           "valeurs": {"obj_ventes": "7"}},
                                          {"site_id": sites["Yaoundé"],
                                           "valeurs": {"obj_ventes": "2"}}])
    assert D(get(c, "mensuel", annee=2026, mois=1, site="Douala").json()["objectifs"]["ventes"]) \
        == 7
    assert D(get(c, "mensuel", annee=2026, mois=1).json()["objectifs"]["ventes"]) == 9


def test_api_sans_droit_marge_aucun_objectif_de_ca_ni_de_marge(make_client, db):
    c = make_client(ADMIN)
    objectifs_charges(c, db)
    _sans_marge(db)
    for chemin in ("mensuel", "annuel"):
        r = get(c, chemin, annee=2026, mois=1)
        assert r.status_code == 200
        assert "lignes_ca_marge" not in r.json()
        assert '"obj_ca"' not in r.text and '"obj_marge"' not in r.text
        assert "912.5" not in r.text and "157.5" not in r.text
    m = get(c, "mensuel", annee=2026, mois=1).json()
    assert "ca" not in m["objectifs"] and "marge" not in m["objectifs"]
    assert D(m["objectifs"]["ventes"]) == 10 and D(m["objectifs"]["frais_mission"]) == 123
    a = get(c, "annuel", annee=2026, mois=1).json()
    assert all("ca" not in s["objectifs"] and "marge" not in s["objectifs"] for s in a["serie_n"])
    assert D(a["serie_n"][0]["objectifs"]["ventes"]) == 10
    par = {x["cle"]: x for x in a["activite"]}
    assert D(par["ventes"]["budget"]) == 10


def test_api_annuel_objectifs_et_nouvelles_rubriques(make_client, db):
    c = make_client(ADMIN)
    objectifs_charges(c, db)
    j = get(c, "annuel", annee=2026, mois=1).json()
    s = j["serie_n"][0]
    assert D(s["objectifs"]["ca"]) == D("912.5") and D(s["objectifs"]["ventes"]) == 10
    assert D(s["objectifs"]["frais_mission"]) == 123
    assert j["serie_n"][1]["objectifs"]["ventes"] is None
    assert {"assurance", "formation", "carburant", "credit_telephonique"} <= set(s)
    assert D(j["lignes_ca_marge"]["ca"]["budget"]) == D("912.5")
    assert D(j["frais_mission"]["budget"]) == 123
    par = {x["cle"]: x for x in j["activite"]}
    assert D(par["ventes"]["budget"]) == 10
    assert get(c, "annuel", annee=2026, mois=1, site="Douala").json()[
        "serie_n"][0]["objectifs"]["ventes"] is None


def test_api_individuel_sans_objectif(make_client, db):
    c = make_client(ADMIN)
    objectifs_charges(c, db)
    r = get(c, "individuel", annee=2026, matricule="E1")
    assert r.status_code == 200
    assert "objectif" not in r.text


def test_api_objectif_vide_ne_rend_pas_le_reel_partiel(make_client, db):
    c = make_client(ADMIN)
    charger_activite(c)
    sites, services = ids(db)
    d, y = sites["Douala"], sites["Yaoundé"]
    sav, vn = services["SAV PL"], services["Commerce VN"]
    put(c, [ln(db, "Douala", "SAV PL", "factures", "50"),
            ln(db, "Yaoundé", "Commerce VN", "factures", "40")])
    # objectif de factures saisi pour une seule des deux cases attendues
    saisir_obj(c, "obj_activite", "cellule", [
        {"site_id": d, "service_id": sav, "valeurs": {"obj_factures": "60"}}])
    j = get(c, "mensuel", annee=2026, mois=1).json()
    par = {x["cle"]: x for x in j["activite"]}
    assert D(par["factures"]["m"]) == 90 and "partiel" not in par["factures"]
    assert D(par["factures"]["budget"]) == 60 and par["factures"]["budget_partiel"] is True
    assert j["budget_partiel"] is True
    del vn, y


def test_annuel_objectif_partiel_si_un_mois_de_reel_n_a_pas_d_objectif():
    avec = periode([ligne(1, productif=True, **{VENTES: 3})], [objectif("obj_ventes", 4),
                                                              objectif("obj_ca", 8)], ca=10)
    sans = periode([ligne(1, productif=True, **{VENTES: 2})], ca=10)
    r = annuel({1: avec, 2: sans}, {}, 2, REFS, Params())
    par = {x["cle"]: x for x in r["activite"]}
    assert par["ventes"]["budget"] == 4 and par["ventes"]["budget_partiel"] is True
    assert r["budget_partiel"] is True
    assert r["lignes_ca_marge"]["ca"]["budget_partiel"] is True
    r = annuel({1: avec, 2: avec}, {}, 2, REFS, Params())
    assert not r["budget_partiel"] and "budget_partiel" not in r["lignes_ca_marge"]["ca"]
