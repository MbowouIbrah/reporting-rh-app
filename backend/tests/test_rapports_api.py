from decimal import Decimal as D

import pytest
from sqlalchemy import select

from app.models.auth import AuditEvent
from app.models.donnees import Periode, Salarie, SituationMensuelle
from app.models.pilotage import ValeurSaisie
from app.models.referentiel import Poste, Site
from tests.test_import_regles import ligne, xlsx

API = "/api/v1"
ADMIN, DRH, EQUIP, VN = ("admin@exemple.invalid", "drh@exemple.invalid", "dps.equipment@exemple.invalid",
                         "dir.commercial.vn@exemple.invalid")
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
BR, ABS = "Brut Réel", "Absences (nb)"


def donnees():
    jan = [
        ligne(MATRICULE="E1", Noms="Ann", Service="SAV PL", **{BR: "1000.5", ABS: 2}),
        ligne(MATRICULE="E2", Noms="Bob", Service="Commerce VN", Site="Yaoundé", **{BR: 2000}),
        ligne(MATRICULE="E3", Noms="Cy", Service="Administration", Site="Yaoundé", **{BR: 4000}),
    ]
    fev = [
        ligne(MOIS="Février", MATRICULE="E1", Noms="Ann", Service="SAV PL", **{BR: 1100}),
        ligne(MOIS="Février", MATRICULE="E2", Noms="Bob", Service="Commerce VN", Site="Yaoundé",
              **{BR: 2100, "Primes sur ventes": 999}),
        ligne(MOIS="Février", MATRICULE="E4", Noms="Dee", Service="SAV PL", **{BR: 500}),
    ]
    return jan + fev


@pytest.fixture()
def charge(make_client, db):
    c = make_client(ADMIN)
    lot = c.post(f"{API}/imports", files={"fichier": ("d.xlsx", xlsx(donnees()), XLSX)}).json()
    assert lot["statut"] == "pret", lot
    assert c.post(f"{API}/imports/{lot['id']}/valider").status_code == 200
    pid = db.scalar(select(Periode.id).where(Periode.annee == 2026, Periode.mois == 1))
    db.add_all([ValeurSaisie(periode_id=pid, indicateur="ca", valeur=D("10000")),
                ValeurSaisie(periode_id=pid, indicateur="marge", valeur=D("2500"))])
    db.commit()
    return c


def get(c, path, **params):
    return c.get(f"{API}/rapports/{path}", params=params)


def test_anonyme_401(make_client):
    assert get(make_client(), "mensuel", annee=2026, mois=1).status_code == 401


def test_mensuel_global_exact_en_chaines(charge):
    r = get(charge, "mensuel", annee=2026, mois=2).json()
    s = r["synthese"]
    # février : 1100 + 2100 + 500 ; la prime sur ventes (exclue du total) ne compte pas
    assert s["ms"]["m"] == "3700.000" or s["ms"]["m"] == "3700"
    assert s["ms"]["m1"] in ("7000.500", "7000.5")
    e = s["effectif"]
    assert (e["debut"], e["recrutements"], e["departs"], e["fin"]) == (3, 1, 1, 3)
    assert s["ca"] is None and s["marge"] is None
    assert all(not c["bloquant"] for c in r["controles"])


def test_comparaison_choisie(charge):
    # Mensuel : février comparé à février lui-même au lieu de janvier (défaut M-1)
    r = get(charge, "mensuel", annee=2026, mois=2, ref_annee=2026, ref_mois=2).json()
    assert D(r["synthese"]["ms"]["m1"]) == D("3700")
    # Période de comparaison sans données : colonne de référence vide, pas d'erreur
    r = get(charge, "mensuel", annee=2026, mois=2, ref_annee=2024, ref_mois=5).json()
    assert r["synthese"]["ms"]["m1"] is None
    # Annuel : comparé à 2026 au lieu de 2025
    a = get(charge, "annuel", annee=2026, mois=2, ref_annee=2026).json()
    assert D(a["cumul_ytd"]["m1"]) == D("10700.5")
    ex = charge.get(f"{API}/rapports/mensuel/export",
                    params={"annee": 2026, "mois": 2, "ref_annee": 2026, "ref_mois": 1})
    assert ex.status_code == 200 and ex.headers["content-type"] == XLSX


def test_marge_visible_admin_et_drh_seulement(charge, make_client):
    for who, visible in ((ADMIN, True), (DRH, True), (EQUIP, False), (VN, False)):
        s = get(make_client(who), "mensuel", annee=2026, mois=1)
        if who in (EQUIP, VN):
            assert "ca" not in s.json()["synthese"] and "marge" not in s.json()["synthese"]
        else:
            assert s.json()["synthese"]["marge"] is not None
        assert s.status_code == 200 and visible == ("marge" in s.json()["synthese"])


def test_perimetre_filtre_cote_serveur(charge, make_client):
    equip = get(make_client(EQUIP), "mensuel", annee=2026, mois=1).json()
    assert D(equip["synthese"]["ms"]["m"]) == D("1000.5")  # SAV PL seul (pas Admin/Commerce VN)
    assert equip["synthese"]["effectif"]["fin"] == 1
    vn = get(make_client(VN), "mensuel", annee=2026, mois=1).json()
    assert D(vn["synthese"]["ms"]["m"]) == 2000
    # le filtre de l'utilisateur ne peut pas élargir le périmètre
    r = get(make_client(EQUIP), "mensuel", annee=2026, mois=1, service="Administration")
    assert r.status_code == 404
    # annuel et périodes passent par le même filtre
    assert D(get(make_client(VN), "annuel", annee=2026, mois=2).json()["cumul_ytd"]["m"]) == 4100
    assert len(get(make_client(VN), "periodes").json()) == 2


@pytest.mark.parametrize("email, ms", [
    ("dir.technique@exemple.invalid", "1000.5"),  # SAV PL
    ("dc.pneumatique@exemple.invalid", None),  # aucun salarié Pneumatique en janvier
    ("resp.sav.engins@exemple.invalid", None),
])
def test_lecteurs_a_un_service(charge, make_client, email, ms):
    c = make_client(email)
    r = get(c, "mensuel", annee=2026, mois=1)
    if ms is None:
        assert r.status_code == 404 or D(r.json()["synthese"]["ms"]["m"] or 0) == 0
    else:
        s = r.json()["synthese"]
        assert D(s["ms"]["m"]) == D(ms) and "marge" not in s and "ca" not in s
    assert get(c, "individuel", annee=2026, matricule="E1").status_code == 403
    f = {"fichier": ("d.xlsx", xlsx(donnees()), XLSX)}
    assert c.post(f"{API}/imports", files=f).status_code == 403


def test_filtre_utilisateur_restreint(charge):
    r = get(charge, "mensuel", annee=2026, mois=1, service="SAV PL").json()
    assert D(r["synthese"]["ms"]["m"]) == D("1000.5")

    assert r["synthese"]["ca"] is None and r["synthese"]["marge"] is None


def test_ca_global_absent_sous_filtre(charge):
    # Le CA n'existe pas par service ou site : pas de marge filtrée (CA global - MS partielle).
    a = get(charge, "annuel", annee=2026, mois=2, service="SAV PL").json()
    assert a["marge_ytd"] is None and a["nb_mois_marge"] == 0 and a["nb_mois_ca"] == 0
    a = get(charge, "annuel", annee=2026, mois=2, site="Yaoundé").json()
    assert a["marge_ytd"] is None


def test_periode_inconnue_404(charge):
    assert get(charge, "mensuel", annee=2026, mois=7).status_code == 404
    assert get(charge, "annuel", annee=2020).status_code == 404
    assert get(charge, "mensuel", annee=2026, mois=13).status_code == 422


def test_annuel_global(charge):
    r = get(charge, "annuel", annee=2026, mois=2).json()
    assert D(r["cumul_ytd"]["m"]) == D("10700.5") and r["cumul_ytd"]["nb_mois"] == 2
    assert D(r["moyenne_mensuelle"]["m"]) == D("5350.25")
    # marge saisie (plus calculée CA − MS)
    assert D(r["marge_ytd"]) == D("2500") and r["nb_mois_marge"] == 1 and r["nb_mois_ca"] == 1
    assert D(r["ca_ytd"]) == D("10000") and D(r["taux_marge_ytd"]) == D("0.25")
    assert D(r["commissions_ytd"]) >= 0 and D(r["primes_ytd"]) >= D("999")
    assert r["cumul_ytd"]["m1"] is None


def test_individuel_nominatif_et_journal(charge, make_client, db):
    assert get(make_client(EQUIP), "individuel", annee=2026, matricule="E1").status_code == 403
    assert get(make_client(VN), "individuel", annee=2026, matricule="E2").status_code == 403
    r = get(make_client(DRH), "individuel", annee=2026, matricule="e1")
    assert r.status_code == 200
    j = r.json()
    assert j["nom"] == "Ann" and j["nb_mois"] == 2 and D(j["cumul"]) == D("2100.5")
    assert j["mois"][0]["rubriques"][ABS] in ("2", "2.000")
    assert j["mois"][0]["rubriques"]["Commission"] is None
    assert get(charge, "individuel", annee=2026, matricule="ZZZ").status_code == 404
    ev = db.scalars(select(AuditEvent).where(AuditEvent.action == "lecture_fiche")).all()
    assert len(ev) == 1


def test_individuel_tous(charge, make_client):
    assert get(make_client(EQUIP), "individuel/tous", annee=2026).status_code == 403
    j = get(make_client(DRH), "individuel/tous", annee=2026).json()
    assert len(j["mois"]) == 12 and j["matricule"] is None
    jan = j["mois"][0]
    assert jan["present"] and jan["effectif"] == 3
    assert D(jan["total"]) == D("7000.5")  # Brut réel compté ; ses composantes hachurées, non
    assert "budget" not in jan
    assert not j["mois"][5]["present"]
    un = get(make_client(DRH), "individuel/tous", annee=2026, matricule="e1").json()
    assert un["nom"] == "Ann" and un["mois"][0]["effectif"] == 1
    sv = get(make_client(DRH), "individuel/tous", annee=2026, service="SAV PL").json()
    assert sv["mois"][0]["effectif"] == 1
    assert get(make_client(DRH), "individuel/tous", annee=2026, matricule="ZZZ").status_code == 404


def test_individuel_hors_perimetre_nominatif(charge, make_client, db):
    """Un lecteur à périmètre avec drapeau nominatif ne voit que son périmètre."""
    from app.models.auth import Utilisateur, UtilisateurPermission

    u = db.scalar(select(Utilisateur).where(Utilisateur.email == EQUIP))
    u.permissions.append(UtilisateurPermission(permission="nominatif"))
    db.commit()
    c = make_client(EQUIP)
    assert get(c, "individuel", annee=2026, matricule="E1").status_code == 200
    assert get(c, "individuel", annee=2026, matricule="E3").status_code == 404  # Administration
    r = get(c, "individuel/tous", annee=2026, matricule="E3")
    assert r.status_code == 404 and "nom" not in r.json()  # pas de fuite du nom
    assert get(c, "individuel/tous", annee=2026, matricule="E1").json()["nom"]


def test_filtres_et_salaries(charge, make_client):
    f = get(make_client(EQUIP), "filtres", annee=2026).json()
    assert f["services"] == ["SAV PL"]
    assert get(make_client(VN), "filtres", annee=2026).json()["services"] == ["Commerce VN"]
    assert "Administration" in get(charge, "filtres", annee=2026).json()["services"]
    assert get(make_client(EQUIP), "salaries", annee=2026).status_code == 403
    noms = [x["matricule"] for x in get(make_client(DRH), "salaries", annee=2026).json()]
    assert noms == sorted(noms) and "E1" in noms


def test_annuel_serie_sans_marge_pour_perimetre(charge, make_client):
    equip = get(make_client(EQUIP), "annuel", annee=2026, mois=2).json()
    assert all("marge" not in x and "taux_marge" not in x for x in equip["serie_n"])
    assert "commissions" in equip["serie_n"][0] and "primes" in equip["serie_n"][0]
    assert "ca_ytd" not in equip and "taux_marge_ytd" not in equip and "primes_ytd" in equip
    assert "lignes_ca_marge" not in equip
    adm = get(charge, "annuel", annee=2026, mois=2).json()
    assert adm["serie_n"][0]["marge"] is not None and "lignes_ca_marge" in adm
    sav = next(x for x in adm["par_service"] if x["service"] == "SAV PL")
    assert sav["nb_mois"] == 2 and sav["moy_m"] is not None


def test_mensuel_bloc_d_indicateurs_et_permissions(charge, make_client):
    r = get(charge, "mensuel", annee=2026, mois=2).json()
    ind = r["d_contrat"]["indicateurs"]
    assert ind[-1]["contrat"] == "TOTAL" and ind[-1]["fin"] == 3
    assert sum(x["fin"] for x in ind[:-1]) == ind[-1]["fin"]
    assert not any(c["bloquant"] for c in r["controles"])
    me = make_client(EQUIP).get(f"{API}/auth/me").json()
    assert "report:read" in me["permissions"] and "nominatif:read" not in me["permissions"]


def test_filtre_type_de_site(charge, db):
    # Douala (E1, E4) passe en agence ; Yaounde reste principal
    db.scalar(select(Site).where(Site.libelle == "Douala")).type_site = "agence"
    db.commit()
    f = get(charge, "filtres", annee=2026).json()
    assert f["types_site"] == ["agence", "principal"]
    assert f["type_par_site"]["Douala"] == "agence"
    r = get(charge, "mensuel", annee=2026, mois=1, type_site="agence").json()
    assert D(r["synthese"]["ms"]["m"]) == D("1000.5") and r["synthese"]["effectif"]["fin"] == 1
    assert r["synthese"]["ca"] is None  # pas de CA par type de site
    assert [c["site"] for c in r["c_site"]] == ["Douala"]  # autres types masqués
    r = get(charge, "mensuel", annee=2026, mois=1, type_site="principal").json()
    assert D(r["synthese"]["ms"]["m"]) == D("6000") and r["synthese"]["effectif"]["fin"] == 2
    a = get(charge, "annuel", annee=2026, mois=2, type_site="agence").json()
    assert a["marge_ytd"] is None and [c["site"] for c in a["c_site"]] == ["Douala"]
    assert get(charge, "mensuel", annee=2026, mois=1, type_site="inconnu").status_code == 422
    ex = get(charge, "mensuel/export", annee=2026, mois=1, type_site="agence")
    assert ex.status_code == 200 and ex.headers["content-type"].startswith(
        "application/vnd.openxmlformats")
    ex = get(charge, "annuel/export", annee=2026, mois=2, type_site="agence")
    assert ex.status_code == 200
    t = get(charge, "individuel/tous", annee=2026, type_site="agence").json()
    assert t["mois"][0]["effectif"] == 1


def test_filtre_activite(charge):
    acts = get(charge, "filtres", annee=2026).json()["activites"]
    assert acts
    total = get(charge, "mensuel", annee=2026, mois=1).json()["synthese"]["effectif"]["fin"]
    fins = [get(charge, "mensuel", annee=2026, mois=1, activite=a).json()["synthese"]["effectif"]["fin"]
            for a in acts]
    assert sum(fins) == total  # chaque salarié a une seule activité
    a = get(charge, "annuel", annee=2026, mois=2, activite=acts[0]).json()
    assert a["ca_ytd"] is None and a["marge_ytd"] is None  # CA global seulement
    assert get(charge, "annuel/export", annee=2026, mois=2, activite=acts[0]).status_code == 200


def test_filtre_type_contrat(charge):
    types = get(charge, "filtres", annee=2026).json()["types_contrat"]
    assert types
    total = get(charge, "mensuel", annee=2026, mois=1).json()["synthese"]["effectif"]["fin"]
    fins = [get(charge, "mensuel", annee=2026, mois=1, type_contrat=t).json()["synthese"]["effectif"]["fin"]
            for t in types]
    assert sum(fins) == total  # chaque salarié a un seul type de contrat
    r = get(charge, "mensuel", annee=2026, mois=2, type_contrat=types[0]).json()
    assert r["synthese"]["ca"] is None  # CA global seulement
    assert r["synthese"]["ms"]["budget"] is None  # pas de budget pour un type de contrat
    a = get(charge, "annuel", annee=2026, mois=2, type_contrat=types[0]).json()
    assert a["ca_ytd"] is None and a["marge_ytd"] is None
    assert get(charge, "annuel/export", annee=2026, mois=2, type_contrat=types[0]).status_code == 200


def test_filtres_combinaisons(charge):
    f = get(charge, "filtres", annee=2026).json()
    combis = f["combinaisons"]
    assert combis and all(len(c) == 6 for c in combis)
    assert sorted({c[0] for c in combis}) == f["services"]
    assert sorted({c[1] for c in combis}) == f["sites"]
    assert sorted({c[4] for c in combis}) == f["types_contrat"]
    # Chaque couple service + site proposé renvoie des effectifs.
    for service, site in {(c[0], c[1]) for c in combis}:
        r = get(charge, "mensuel", annee=2026, mois=1, service=service, site=site).json()
        assert r["synthese"]["effectif"]["fin"] > 0, (service, site)


def test_filtre_poste(charge, db):
    chef = Poste(libelle="Chef atelier")
    db.add(chef)
    db.flush()
    e4 = db.scalar(select(Salarie.id).where(Salarie.matricule == "E4"))
    for s in db.scalars(select(SituationMensuelle).where(SituationMensuelle.salarie_id == e4)):
        s.poste_id = chef.id
    db.commit()
    assert "Chef atelier" in get(charge, "filtres", annee=2026).json()["postes"]
    r = get(charge, "mensuel", annee=2026, mois=2, poste="Chef atelier").json()
    assert D(r["synthese"]["ms"]["m"]) == D("500") and r["synthese"]["effectif"]["fin"] == 1
    assert r["synthese"]["ca"] is None
    assert r["synthese"]["ms"]["budget"] is None  # pas de budget pour un poste
    assert get(charge, "mensuel", annee=2026, mois=1, poste="Chef atelier").status_code == 404
    t = get(charge, "individuel/tous", annee=2026, poste="Chef atelier").json()
    assert not t["mois"][0]["present"] and t["mois"][1]["effectif"] == 1


def test_filtre_employe_par_matricule(charge, make_client, db):
    r = get(charge, "mensuel", annee=2026, mois=1, matricule="E1").json()
    assert D(r["synthese"]["ms"]["m"]) == D("1000.5") and r["synthese"]["effectif"]["fin"] == 1
    a = get(charge, "annuel", annee=2026, mois=2, matricule="e1").json()
    assert D(a["cumul_ytd"]["m"]) == D("2100.5")
    assert get(charge, "annuel/export", annee=2026, mois=2, matricule="E1").status_code == 200
    assert get(charge, "mensuel", annee=2026, mois=1, matricule="ZZ9").status_code == 404
    # sans droit nominatif : refuse
    assert get(make_client(EQUIP), "mensuel", annee=2026, mois=1, matricule="E1").status_code == 403
    # avec le drapeau nominatif mais hors perimetre : rien ne fuit
    from app.models.auth import Utilisateur, UtilisateurPermission

    u = db.scalar(select(Utilisateur).where(Utilisateur.email == EQUIP))
    u.permissions.append(UtilisateurPermission(permission="nominatif"))
    db.commit()
    c = make_client(EQUIP)
    assert get(c, "mensuel", annee=2026, mois=1, matricule="E1").status_code == 200
    assert get(c, "mensuel", annee=2026, mois=1, matricule="E3").status_code == 404


def test_individuel_colonnes_exclusions_et_deporte(make_client, db):
    c = make_client(ADMIN)
    lignes = [ligne(ANNÉE=2025, MATRICULE="E1", Noms="Ann", **{
        "Salaire brut garantie": 500, "Commission": 100, "Primes sur ventes": 30,
        "Primes sur résultats": 20, "Primes exceptionnelles": 7, "Logement site déporté": 0,
        "Charges Patronales": 900, "Assurance Maladie": 80, BR: 5000})]
    lot = c.post(f"{API}/imports", files={"fichier": ("d.xlsx", xlsx(lignes), XLSX)}).json()
    assert c.post(f"{API}/imports/{lot['id']}/valider").status_code == 200
    j = get(c, "individuel/tous", annee=2025).json()
    # ordre global des rubriques (celui de DONNEES, modifiable par PUT /parametrage/colonnes)
    assert j["rubriques"] == [
        "Primes sur ventes", "Primes sur résultats", "Bonus", "Primes de productivité", "Commission",
        "Salaire brut garanti", "Frais de mission", "Primes exceptionnelles", "Logement site déporté",
        "Carburant véhicule service", "Crédit téléphonique", "Brut réel", "Marge MAD + TVA"]
    assert set(j["exclues"]) == {"Salaire brut garanti", "Commission", "Primes de productivité",
                                 "Primes sur ventes", "Primes sur résultats"}
    jan = j["mois"][0]
    assert D(jan["montants"]["Primes sur ventes"]) == 30 and jan["staff"]["Primes sur résultats"] == 1
    assert D(jan["montants"]["Brut réel"]) == 5000
    assert D(jan["total"]) == 5007  # Brut réel + Primes exceptionnelles : colonnes exclues retirées
    assert jan["deporte"] is False
    db.scalar(select(Site).where(Site.libelle == "Douala")).type_site = "deporte"
    db.commit()
    assert get(c, "individuel/tous", annee=2025).json()["mois"][0]["deporte"] is True
