from decimal import Decimal as D

from app.kpi.niveaux import (
    Employe,
    cle_du_niveau,
    niveau_de,
    niveau_des_lignes,
    niveau_par_defaut,
    resoudre,
)

SITES, SERVICES = [1, 2], [10, 20]
EMPLOYES = [
    Employe(1, 10, {"ca": D("500"), "marge": D("50")}),
    Employe(1, 10, {"ca": D("300")}),
    Employe(2, 20, {"ca": D("200"), "marge": D("20")}),
    Employe(2, 10, {}),
]


def res(groupe="ca_marge", niveau="cellule", saisies=None, employes=EMPLOYES):
    return resoudre(groupe, niveau, sites=SITES, services=SERVICES, saisies=saisies or {},
                    employes=employes)


def case(r, site, service):
    return next(c for c in r.cases if c.cle == (site, service))


def test_niveau_de_et_cle():
    assert [niveau_de(*k) for k in ((None, None), (1, None), (None, 10), (1, 10))] == [
        "global", "site", "service", "cellule"]
    assert cle_du_niveau("site", 1, 10) == (1, None)
    assert cle_du_niveau("service", 1, 10) == (None, 10)
    assert cle_du_niveau("global", 1, 10) == (None, None)
    assert niveau_des_lignes([]) is None
    assert niveau_des_lignes([(None, None), (1, 10)]) == "cellule"


def test_niveau_par_defaut():
    assert niveau_par_defaut("activite", []) == "cellule"
    assert niveau_par_defaut("ca_marge", []) == "global"
    assert niveau_par_defaut("ca_marge", [Employe(1, 10, {"ca": D(1)})]) == "cellule"
    assert niveau_par_defaut("ca_marge", [Employe(1, 10, {"marge": D(1)})]) == "cellule"
    assert niveau_par_defaut("ca_marge", [Employe(1, 10, {})]) == "global"


def test_calcule_depuis_les_employes_sans_saisie():
    r = res()
    c = case(r, 1, 10)
    assert c.valeurs["ca"].employes == 800 and c.valeurs["ca"].valeur == 800
    assert c.valeurs["ca"].origine == "calcule" and c.valeurs["ca"].saisi is None
    assert c.valeurs["marge"].valeur == 50
    vide = case(r, 2, 10)  # employé sans CA : case attendue, vide
    assert vide.valeurs["ca"].valeur is None and vide.valeurs["ca"].origine is None
    assert r.totaux["ca"].valeur == 1000 and r.totaux["ca"].partiel
    assert (r.totaux["ca"].renseignes, r.totaux["ca"].attendus) == (2, 3)


def test_la_saisie_gagne_sans_jamais_s_additionner():
    r = res(saisies={("ca", 1, 10): D("1000.5")})
    v = case(r, 1, 10).valeurs["ca"]
    assert (v.saisi, v.employes, v.valeur, v.origine) == (D("1000.5"), 800, D("1000.5"), "saisi")
    assert v.ecart == D("200.5")  # le non réparti
    assert r.totaux["ca"].valeur == D("1000.5") + 200


def test_activite_n_a_pas_de_calcul_employe():
    r = res("activite", saisies={("or", 1, 10): D("7")})
    assert case(r, 1, 10).valeurs["or"].valeur == 7
    assert case(r, 1, 10).valeurs["devis"].valeur is None
    assert r.totaux["or"].valeur == 7 and r.totaux["or"].partiel
    assert r.totaux["devis"].valeur is None and r.totaux["devis"].renseignes == 0


def test_niveau_global_somme_des_employes_ou_saisie():
    assert res(niveau="global").totaux["ca"].valeur == 1000
    r = res(niveau="global", saisies={("ca", None, None): D("900")})
    assert r.cases[0].valeurs["ca"].valeur == 900 and r.cases[0].valeurs["ca"].ecart == -100
    assert not r.totaux["ca"].partiel and r.totaux["ca"].attendus == 1


def test_niveau_site_et_service_regroupent_les_employes():
    r = res(niveau="site")
    assert case(r, 1, None).valeurs["ca"].valeur == 800
    assert case(r, 2, None).valeurs["ca"].valeur == 200
    assert not r.totaux["ca"].partiel
    r = res(niveau="service", saisies={("marge", None, 20): D("5")})
    assert case(r, None, 10).valeurs["ca"].valeur == 800
    assert case(r, None, 20).valeurs["marge"].origine == "saisi"
    assert case(r, None, 20).valeurs["marge"].ecart == -15


def test_lignes_d_un_autre_niveau_ignorees():
    r = res(niveau="site", saisies={("ca", None, None): D("9"), ("ca", 1, 10): D("8")})
    assert case(r, 1, None).valeurs["ca"].saisi is None
    assert r.totaux["ca"].valeur == 1000


def test_une_valeur_saisie_hors_cases_attendues_n_est_pas_perdue():
    r = res("activite", saisies={("or", 2, 20): D("3"), ("or", 1, 20): D("4")})
    assert case(r, 1, 20).valeurs["or"].valeur == 4  # aucun employé : la case existe quand même
    assert r.totaux["or"].valeur == 7


def test_exactitude_des_decimales():
    r = res(saisies={("ca", 1, 10): D("0.1234567"), ("ca", 2, 20): D("0.2")})
    assert r.totaux["ca"].valeur == D("0.3234567")
