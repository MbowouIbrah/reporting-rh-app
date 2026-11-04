from decimal import Decimal as D

from hypothesis import given, settings
from hypothesis import strategies as st

from app.kpi import formules as f
from app.kpi.moteur import (
    Budgets,
    Ligne,
    Params,
    PeriodeData,
    Refs,
    annuel,
    individuel,
    mensuel,
)

REFS = Refs(
    services=("SAV PL", "Commerce VN"), activites=("Front office", "Back Office"),
    sites=("Douala", "Yaoundé"), contrats=("CDI", "CDD", "MAD"),
    rubriques=("Absences (nb)", "Brut Réel", "Primes sur ventes", "Commission"))
EXCL = frozenset({"Absences (nb)", "Primes sur ventes"})


def L(sid, service="SAV PL", site="Douala", act="Front office", ctr="CDI", **m):
    noms = {"Absences_nb": "Absences (nb)"}
    return Ligne(sid, service, site, act, ctr,
                 {noms.get(k, k.replace("_", " ")): D(v) for k, v in m.items()})


def pd(*lignes, ca=None, marge=None):
    return PeriodeData(tuple(lignes), EXCL, ca=None if ca is None else D(ca),
                       marge=None if marge is None else D(marge))


# ---------- formules ----------
def test_variation_et_pct():
    assert f.variation(D(120), D(100)) == 20
    assert f.variation_pct(D(120), D(100)) == D("0.2")
    assert f.variation(D(1), None) is None and f.variation_pct(None, D(1)) is None
    assert f.variation_pct(D(5), D(0)) == f.NA  # écart documenté : l'Excel affichait 0


def test_rotation():
    assert f.taux_rotation(2, 4, 10, 8) == D(3) / D(9)  # (6/2)/(18/2)
    assert f.taux_rotation(0, 0, 0, 0) == f.NA
    assert f.taux_rotation(1, 1, None, 5) is None


def test_absenteisme_budget_marge():
    assert f.taux_absenteisme(D(11), 10, D(22)) == D("0.05")
    assert f.taux_absenteisme(D(1), 0, D(22)) == f.NA
    assert f.budget(3, D(600000)) == 1_800_000 and f.budget(3, None) is None
    assert f.ecart_budget(D(2_000_000), D(1_800_000)) == (D(200000), D(200000) / D(1_800_000))
    assert f.ecart_budget(D(1), D(0)) == (D(1), f.NA)
    assert f.ecart_budget(None, D(1)) == (None, None)
    assert f.taux_marge(D(100), D(40)) == D("0.4")  # marge saisie / CA
    assert f.taux_marge(D(100), D(-20)) == D("-0.2")
    assert f.taux_marge(D(0), D(60)) == f.NA and f.taux_marge(None, D(1)) is None
    assert f.taux_marge(D(100), None) is None  # jamais 0 sans marge saisie
    assert f.moyenne(D(90), 3) == 30 and f.moyenne(D(0), 0) is None


# ---------- mensuel ----------
def test_total_charges_exclut_les_rubriques_exclues_et_vide_vaut_zero():
    p = pd(L(1, Brut_Réel=1000, Absences_nb=3, Primes_sur_ventes=500), L(2, Commission=50))
    assert p.total(p.lignes[0]) == 1000 and p.total(p.lignes[1]) == 50 and p.ms == 1050


def test_mensuel_valeurs_et_absence_de_m1():
    cur = pd(L(1, Brut_Réel=1000, Absences_nb=2), L(2, ctr="CDD", Brut_Réel=500, Absences_nb=1),
             ca=2000, marge=500)
    r = mensuel(cur, None, REFS, Params())
    s = r["synthese"]
    assert s["ms"]["m"] == 1500 and s["ms"]["m1"] is None and s["ms"]["var"] is None
    assert s["effectif"] == {"debut": None, "recrutements": None, "departs": None, "fin": 2,
                             "variation": None}
    assert s["taux_rotation"] is None
    assert s["absences"]["m"] == 3
    assert s["taux_absenteisme"] == D(3) / D(44)
    assert s["ms"]["budget"] == 1_200_000 and s["ms"]["ecart"] == 1500 - 1_200_000
    assert s["marge"] == 500 and s["taux_marge"] == D(500) / D(2000)
    assert all(not c["bloquant"] for c in r["controles"])


def test_mensuel_sans_ca_marge_vide_jamais_zero():
    s = mensuel(pd(L(1, Brut_Réel=10)), None, REFS, Params())["synthese"]
    assert s["ca"] is None and s["marge"] is None and s["taux_marge"] is None


def test_mensuel_ca_sans_marge_saisie_reste_vide():
    s = mensuel(pd(L(1, Brut_Réel=10), ca=100), None, REFS, Params())["synthese"]
    assert s["ca"] == 100 and s["marge"] is None and s["taux_marge"] is None


def test_mensuel_lignes_ca_marge_avec_mois_precedent():
    prev = pd(ca=80, marge=20)  # CA saisi sans paie le mois précédent : comparé quand même
    r = mensuel(pd(L(1, Brut_Réel=10), ca=100), prev, REFS, Params())["lignes_ca_marge"]
    assert (r["ca"]["m"], r["ca"]["m1"], r["ca"]["var"]) == (100, 80, 20)
    assert r["marge"]["m"] is None and r["marge"]["m1"] == 20


def test_mensuel_mouvements_effectif():
    prev = pd(L(1, Brut_Réel=100), L(2, Brut_Réel=100), L(3, Brut_Réel=100))
    cur = pd(L(2, Brut_Réel=150), L(3, Brut_Réel=100), L(4, Brut_Réel=100), L(5, Brut_Réel=1))
    s = mensuel(cur, prev, REFS, Params())["synthese"]
    e = s["effectif"]
    assert (e["debut"], e["recrutements"], e["departs"], e["fin"]) == (3, 2, 1, 4)
    assert s["taux_rotation"] == (D(3) / 2) / (D(7) / 2)
    assert s["ms"]["var"] == 351 - 300 and s["ms"]["var_pct"] == D(51) / 300


def test_mensuel_m1_vide_est_absent():
    r = mensuel(pd(L(1, Brut_Réel=10)), pd(), REFS, Params())
    assert r["synthese"]["ms"]["m1"] is None


def test_blocs_service_site_contrat():
    cur = pd(L(1, Brut_Réel=100), L(2, service="Commerce VN", site="Yaoundé", act="Back Office",
                                    ctr="MAD", Brut_Réel=40))
    r = mensuel(cur, None, REFS, Params())
    svc = {b["service"]: b for b in r["b_service_activite"]}
    assert svc["SAV PL"]["total"]["m"] == 100
    assert {a["activite"]: a["m"] for a in svc["Commerce VN"]["activites"]} == {
        "Front office": 0, "Back Office": 40}
    assert {c["site"]: (c["ms"]["m"], c["effectif"]["m"]) for c in r["c_site"]} == {
        "Douala": (100, 1), "Yaoundé": (40, 1)}
    assert {e["contrat"]: e["m"] for e in r["d_contrat"]["effectifs"]} == {"CDI": 1, "CDD": 0,
                                                                          "MAD": 1}
    assert r["d_contrat"]["total"]["m"] == 2
    mad = next(x for x in r["d_contrat"]["ventilation"]
               if (x["contrat"], x["activite"]) == ("MAD", "Back Office"))
    assert mad["effectif"]["m"] == 1 and mad["ms"]["m"] == 40
    assert r["a_type_charge"][-1] == {"rubrique": "TOTAL CHARGES", "exclu": False,
                                      "m1": None,
                                      "m": 140, "var": None, "var_pct": None,
                                      "budget": 1_200_000, "ecart": 140 - 1_200_000,
                                      "ecart_pct": D(140 - 1_200_000) / 1_200_000}
    assert [a["effectif"]["m"] for a in svc["Commerce VN"]["activites"]] == [0, 1]
    assert svc["SAV PL"]["effectif"]["m"] == 1
    flags = {x["rubrique"]: x["exclu"] for x in r["a_type_charge"]}
    assert flags["Primes sur ventes"] and not flags["Brut Réel"] and "Absences (nb)" not in flags


def test_controle_bloquant_si_referentiel_incomplet():
    cur = pd(L(1, ctr="Stagiaire", Brut_Réel=10))  # contrat hors référentiel
    cs = {c["controle"]: c for c in mensuel(cur, None, REFS, Params())["controles"]}
    assert cs["Total contrats = somme des types"]["bloquant"]


def test_regle_datee_changeant_le_total():
    ligne = L(1, Brut_Réel=100, Primes_sur_ventes=50)
    assert PeriodeData((ligne,), frozenset()).ms == 150
    assert PeriodeData((ligne,), EXCL).ms == 100


# ---------- annuel / individuel ----------
def test_annuel_cumul_moyenne_nb_mois_et_marge_ytd():
    n = {1: pd(L(1, Brut_Réel=100), ca=300, marge=200), 2: pd(L(1, Brut_Réel=200)),
         3: pd(ca=50),  # CA saisi sans paie : compte dans le CA, pas dans la MS
         4: pd(L(1, Brut_Réel=300), ca=500, marge=-100)}
    n1 = {1: pd(L(1, Brut_Réel=50)), 2: pd(L(1, Brut_Réel=50))}
    r = annuel(n, n1, 4, REFS, Params())
    assert r["cumul_ytd"]["m"] == 600 and r["cumul_ytd"]["nb_mois"] == 3
    assert r["cumul_ytd"]["m1"] == 100 and r["cumul_ytd"]["nb_mois_n1"] == 2
    assert r["moyenne_mensuelle"]["m"] == 200
    assert r["marge_ytd"] == 200 - 100 and r["nb_mois_marge"] == 2
    assert r["lignes_ca_marge"]["ca"]["m"] == 850 and r["lignes_ca_marge"]["marge"]["m"] == 100
    assert r["lignes_ca_marge"]["ca"]["m1"] is None and r["lignes_ca_marge"]["marge"]["m1"] is None
    assert r["ca_ytd"] == 850 and r["nb_mois_ca"] == 3
    assert r["taux_marge_ytd"] == D(100) / D(800)  # mêmes mois que les marges
    assert r["serie_n"][2]["ms"] is None and r["serie_n"][3]["ms"] == 300  # mars sans paie
    assert r["serie_n"][2]["ca"] == 50 and r["serie_n"][2]["marge"] is None
    assert r["serie_n"][3]["taux_marge"] == D(-100) / D(500)
    r2 = annuel(n, n1, 2, REFS, Params())
    assert r2["cumul_ytd"]["m"] == 300 and r2["marge_ytd"] == 200 and r2["nb_mois_ca"] == 1


def test_annuel_blocs_coherents_avec_le_cumul():
    n = {1: pd(L(1, Brut_Réel=100), L(2, Brut_Réel=40, site="Yaoundé", ctr="CDD", Absences_nb=3)),
         2: pd(L(1, Brut_Réel=200), L(3, Brut_Réel=60, service="Commerce VN"))}
    n1 = {1: pd(L(1, Brut_Réel=50), L(9, Brut_Réel=10))}
    bud = {1: Budgets(site={"Douala": D(500)}), 2: Budgets(site={"Douala": D(400)})}
    r = annuel(n, n1, 12, REFS, Params(), bud)
    total = next(x for x in r["a_type_charge"] if x["rubrique"] == "TOTAL CHARGES")
    assert total["m"] == r["cumul_ytd"]["m"] == 400 and total["m1"] == 60
    assert sum(b["total"]["m"] for b in r["b_service_activite"]) == 400
    assert sum(c["ms"]["m"] for c in r["c_site"]) == 400
    douala = next(c for c in r["c_site"] if c["site"] == "Douala")
    assert douala["ms"]["budget"] == 900 and douala["effectif"]["m"] == D("1.5")
    assert next(c for c in r["c_site"] if c["site"] == "Yaoundé")["ms"]["budget"] is None
    tot = r["d_contrat"]["indicateurs"][-1]
    assert (tot["debut"], tot["fin"], tot["recrutements"], tot["departs"]) == (2, 2, 2, 1)
    assert tot["absences"] == 3


def test_annuel_resume_n1_part_mad_et_ca_par_effectif():
    n = {1: pd(L(1, Commission=10), L(2, ctr="MAD"), ca=600),
         2: pd(L(1, Commission=20, Productivité_Ateliers=5), L(2, ctr="MAD"), L(3, ctr="MAD"), ca=300)}
    n1 = {1: pd(L(1, Commission=40), ca=200), 3: pd(L(1), ca=999)}  # mars N-1 hors période
    r = annuel(n, n1, 2, REFS, Params())
    assert (r["ca_cumul"]["m"], r["ca_cumul"]["m1"], r["ca_cumul"]["var_pct"]) == (900, 200, D("3.5"))
    assert (r["commissions_cumul"]["m"], r["commissions_cumul"]["m1"]) == (30, 40)
    assert (r["primes_cumul"]["m"], r["primes_cumul"]["m1"]) == (5, 0)
    assert r["effectif_moyen"]["m"] == D("2.5") and r["effectif_moyen"]["m1"] == 1
    assert r["ca_par_effectif"]["m"] == D(900) / D("2.5") and r["ca_par_effectif"]["m1"] == 200
    # effectif de fin : février N contre février N-1 (absent)
    assert r["mois_fin"] == 2 and r["effectif_fin"]["m"] == 3 and r["effectif_fin"]["m1"] is None
    mad = r["effectif_fin_contrat"]["MAD"]
    assert mad["m"] == 2 and mad["part"] == D(2) / D(3)
    vide = annuel({}, {}, 2, REFS, Params())
    assert vide["effectif_fin"]["m"] is None and vide["ca_par_effectif"]["m"] is None


def test_annuel_mad_sites_deportes_effectif_de_fin():
    dep = {"type_site": "deporte"}
    n = {1: pd(L(1, ctr="MAD"), Ligne(2, "SAV PL", "Dimon", "Front office", "MAD", **dep)),
         2: pd(L(1, ctr="MAD"), Ligne(2, "SAV PL", "Dimon", "Front office", "MAD", **dep),
               Ligne(3, "SAV PL", "Dimon", "Front office", "MAD", **dep),
               Ligne(4, "SAV PL", "Dimon", "Front office", "CDI", **dep))}
    n1 = {2: pd(L(1, ctr="MAD"))}
    r = annuel(n, n1, 2, REFS, Params())
    assert (r["mad_fin"]["m"], r["mad_fin"]["m1"]) == (3, 1)
    assert r["mad_deportes_fin"]["m"] == 2 and r["mad_deportes_fin"]["part"] == D(2) / D(3)
    assert annuel({}, {}, 2, REFS, Params())["mad_deportes_fin"]["part"] is None


def test_annuel_masse_par_contrat_frais_et_logement():
    n = {1: pd(L(1, Brut_Réel=300, Frais_de_mission=20), L(2, ctr="CDD", Brut_Réel=100)),
         2: pd(L(1, Brut_Réel=300, **{"Logement site déporté": 5}))}
    n1 = {1: pd(L(1, Brut_Réel=200))}
    r = annuel(n, n1, 2, REFS, Params())
    cdi, cdd = r["ms_contrat"]["CDI"], r["ms_contrat"]["CDD"]
    assert (cdi["m"], cdi["m1"], cdd["m"], cdd["m1"]) == (625, 200, 100, 0)
    assert sum(r["ms_contrat"][c]["m"] for c in REFS.contrats) == r["cumul_ytd"]["m"]
    assert cdd["part"] == D(100) / D(725)
    assert r["frais_mission_ytd"] == 20 and r["logement_ytd"] == 5
    assert r["serie_n"][1]["logement"] == 5 and r["serie_n"][0]["frais_mission"] == 20


def test_annuel_sans_n1():
    r = annuel({1: pd(L(1, Brut_Réel=10))}, {}, 12, REFS, Params())
    assert r["cumul_ytd"]["m1"] is None and r["moyenne_mensuelle"]["m1"] is None


def test_individuel_douze_mois():
    pds = {1: pd(L(7, Brut_Réel=100, Absences_nb=2)), 3: pd(L(7, Brut_Réel=300), L(8, Brut_Réel=9))}
    r = individuel(pds, 7, REFS)
    assert [m["present"] for m in r["mois"]][:4] == [True, False, True, False]
    assert r["cumul"] == 400 and r["nb_mois"] == 2 and r["moyenne"] == 200
    assert r["mois"][0]["rubriques"]["Absences (nb)"] == 2
    assert r["mois"][0]["rubriques"]["Commission"] is None  # cellule vide != 0


# ---------- invariants ----------
montants = st.dictionaries(st.sampled_from(REFS.rubriques),
                           st.decimals(0, 10**9, places=3), max_size=4)
lignes_st = st.lists(
    st.builds(lambda i, s, si, a, c, m: Ligne(i, s, si, a, c, m), st.integers(1, 40),
              st.sampled_from(REFS.services), st.sampled_from(REFS.sites),
              st.sampled_from(REFS.activites), st.sampled_from(REFS.contrats), montants),
    max_size=30, unique_by=lambda x: x.salarie_id)


@settings(max_examples=150, deadline=None)
@given(lignes_st, lignes_st)
def test_invariants_toujours_vrais(cur_l, prev_l):
    """A = services = sites ; contrats = CDI+CDD+MAD ; fin = début + R − D : écart exactement nul."""
    if not cur_l:
        return
    cur, prev = PeriodeData(tuple(cur_l), EXCL), PeriodeData(tuple(prev_l), EXCL)
    r = mensuel(cur, prev, REFS, Params())
    for c in r["controles"]:
        assert c["ecart"] == 0 and not c["bloquant"], c
    e = r["synthese"]["effectif"]
    if prev_l:
        assert e["debut"] + e["recrutements"] - e["departs"] == e["fin"]


def test_budgets_blocs_abc():
    cur = pd(L(1, Brut_Réel=1000), L(2, service="Commerce VN", site="Yaoundé", Brut_Réel=500))
    bud = Budgets({"Brut Réel": D(800), "Commission": D(0)}, {"SAV PL": D(900)},
                  {"Yaoundé": D(250)})
    r = mensuel(cur, None, REFS, Params(), bud)
    a = {x["rubrique"]: x for x in r["a_type_charge"]}
    assert a["Brut Réel"]["budget"] == 800 and a["Brut Réel"]["ecart"] == 700
    assert a["Brut Réel"]["ecart_pct"] == D(700) / 800
    assert a["Commission"]["ecart_pct"] == f.NA  # budget nul
    assert a["Primes sur ventes"]["budget"] is None and a["Primes sur ventes"]["ecart"] is None
    svc = {b["service"]: b["total"] for b in r["b_service_activite"]}
    assert svc["SAV PL"]["ecart"] == 100 and svc["Commerce VN"]["budget"] is None
    sites = {c["site"]: c["ms"] for c in r["c_site"]}
    assert sites["Yaoundé"]["ecart"] == 250 and sites["Douala"]["ecart_pct"] is None
    # le total reste la formule budget_employe x effectif, jamais la somme des budgets saisis
    assert a["TOTAL CHARGES"]["budget"] == 1_200_000


def test_mensuel_effectif_par_contrat_et_site():
    cur = pd(L(1), L(2, ctr="CDD"), L(3, site="Yaoundé"))
    prev = pd(L(1), L(4, ctr="MAD", site="Yaoundé"))
    r = mensuel(cur, prev, REFS, Params())
    par_site = {c["site"]: {k: {"m": v["m"], "m1": v["m1"]} for k, v in c["effectif_contrat"].items()}
                for c in r["c_site"]}
    assert par_site["Douala"] == {"CDI": {"m": 1, "m1": 1}, "CDD": {"m": 1, "m1": 0},
                                  "MAD": {"m": 0, "m1": 0}}
    assert par_site["Yaoundé"]["CDI"] == {"m": 1, "m1": 0}
    assert par_site["Yaoundé"]["MAD"] == {"m": 0, "m1": 1}
    sans = mensuel(cur, None, REFS, Params())
    cdi = sans["c_site"][0]["effectif_contrat"]["CDI"]
    assert (cdi["m"], cdi["m1"], cdi["var"]) == (1, None, None)


def test_annuel_effectif_par_contrat_et_site():
    n = {1: pd(L(1), L(2, ctr="CDD")), 2: pd(L(1))}
    n1 = {1: pd(L(1), L(5, ctr="CDD"))}
    r = annuel(n, n1, 2, REFS, Params())
    douala = next(c for c in r["c_site"] if c["site"] == "Douala")
    ec = {k: {"m": v["m"], "m1": v["m1"]} for k, v in douala["effectif_contrat"].items()}
    assert ec["CDI"] == {"m": D(1), "m1": D(1)}
    assert ec["CDD"] == {"m": D("0.5"), "m1": D(1)}
    assert ec["MAD"] == {"m": D(0), "m1": D(0)}
    assert douala["effectif"]["m"] == D("1.5")
    vide = annuel(n, {}, 2, REFS, Params())
    assert next(c for c in vide["c_site"] if c["site"] == "Douala")["effectif_contrat"][
        "CDI"]["m1"] is None


def test_masse_par_contrat_et_site_somme_au_site():
    cur = pd(L(1), L(2, ctr="CDD"), L(3, site="Yaoundé"))
    r = mensuel(cur, pd(L(1)), REFS, Params())
    a = annuel({1: cur}, {1: pd(L(1))}, 1, REFS, Params())
    for blocs in (r, a):
        for c in blocs["c_site"]:
            assert sum(v["m"] for v in c["ms_contrat"].values()) == c["ms"]["m"]
    douala = next(c for c in r["c_site"] if c["site"] == "Douala")
    assert douala["ms_contrat"]["MAD"]["m"] == 0
    assert douala["ms_contrat"]["CDI"]["m1"] == douala["ms"]["m1"]


def test_annuel_serie_frais_mission_remuneration_et_contrats():
    n = {1: pd(L(1, Brut_Réel=100, Frais_de_mission=30, Primes_sur_ventes=20, Absences_nb=2),
               L(2, Brut_Réel=50, ctr="MAD"))}
    s = annuel(n, {}, 1, REFS, Params())["serie_n"]
    assert s[0]["frais_mission"] == 30
    assert s[0]["remuneration"] == 180 + 20  # TOTAL CHARGES + exclusions hors absences
    assert s[0]["effectif_contrat"] == {"CDI": 1, "CDD": 0, "MAD": 1}
    assert s[1]["frais_mission"] is None and s[1]["effectif_contrat"] is None


def test_total_sites_et_services_par_contrat():
    cur = pd(L(1, Brut_Réel=100), L(2, service="Commerce VN", site="Yaoundé", act="Back Office",
                                    ctr="MAD", Brut_Réel=40))
    r = mensuel(cur, pd(L(1, Brut_Réel=80)), REFS, Params())
    t = r["c_site_total"]
    assert (t["ms"]["m"], t["ms"]["m1"], t["ms"]["var"]) == (140, 80, 60)
    assert (t["effectif"]["m"], t["effectif"]["m1"]) == (2, 1)
    vn = next(b for b in r["b_service_activite"] if b["service"] == "Commerce VN")
    assert {c: v["m"] for c, v in vn["ms_contrat"].items()} == {"CDI": 0, "CDD": 0, "MAD": 40}
    assert {c: v["m"] for c, v in vn["effectif_contrat"].items()} == {"CDI": 0, "CDD": 0, "MAD": 1}


def test_stage_affiche_seulement_avec_des_lignes():
    refs = Refs(REFS.services, REFS.activites, REFS.sites, ("CDI", "CDD", "MAD", "Stage"), REFS.rubriques)
    sans = mensuel(pd(L(1, Brut_Réel=100)), None, refs, Params())
    assert "Stage" not in sans["c_site"][0]["effectif_contrat"]
    assert [e["contrat"] for e in sans["d_contrat"]["effectifs"]] == ["CDI", "CDD", "MAD"]
    avec = mensuel(pd(L(1, Brut_Réel=100), L(2, ctr="Stage")), None, refs, Params())
    assert [e["contrat"] for e in avec["d_contrat"]["effectifs"]] == ["CDI", "CDD", "MAD", "Stage"]
    assert avec["c_site"][0]["effectif_contrat"]["Stage"]["m"] == 1
    an = annuel({1: pd(L(1, Brut_Réel=100))}, {}, 1, refs, Params())
    assert "Stage" not in an["effectif_fin_contrat"] and "Stage" not in an["ms_contrat"]
    an2 = annuel({1: pd(L(1, ctr="Stage"))}, {}, 1, refs, Params())
    assert "Stage" in an2["effectif_fin_contrat"]


# ---------- salaire, primes et exclusions changeantes ----------
REFS_F = Refs(
    services=("SAV PL",), activites=("Front office",), sites=("Douala",), contrats=("CDI",),
    rubriques=("Absences (nb)", "Brut Réel", "Salaire brut garantie", "Bonus", "Commission",
               "Primes sur ventes", "Frais de mission", "Charges Patronales", "Rubrique neuve"))
EXCL_F = frozenset({"Absences (nb)", "Salaire brut garantie", "Commission", "Primes sur ventes"})


def pdf(*lignes):
    return PeriodeData(tuple(lignes), EXCL_F)


def _lignes_f():
    return L(1, Brut_Réel=1000, Salaire_brut_garantie=700, Bonus=50, Commission=30,
             Primes_sur_ventes=20, Frais_de_mission=40, Charges_Patronales=200,
             Rubrique_neuve=5, Absences_nb=2)


def test_mensuel_total_charges_et_salaire_primes():
    cur = pdf(_lignes_f())
    prev = pdf(L(1, Brut_Réel=900, Bonus=10))
    r = mensuel(cur, prev, REFS_F, Params(), Budgets(rubrique={"Bonus": D(60)}))
    lignes = {x["rubrique"]: x for x in r["a_type_charge"]}
    assert "a_familles" not in r and "famille" not in lignes["Bonus"]
    assert lignes["TOTAL CHARGES"]["m"] == cur.ms == 1295  # 1000 + 50 + 40 + 200 + 5
    assert lignes["TOTAL CHARGES"]["m1"] == 910
    s = r["synthese"]
    assert s["salaire"]["m"] == 700 and s["salaire"]["m1"] == 0
    assert s["primes_toutes"]["m"] == 100 and s["primes_toutes"]["m1"] == 10


def test_annuel_serie_et_cumuls_salaire_primes():
    n = {1: pdf(_lignes_f()), 2: pdf(L(1, Brut_Réel=500, Salaire_brut_garantie=300))}
    r = annuel(n, {}, 2, REFS_F, Params())
    total = next(x for x in r["a_type_charge"] if x["rubrique"] == "TOTAL CHARGES")
    assert "a_familles" not in r and total["m1"] is None  # pas de N-1
    s = r["serie_n"]
    assert (s[0]["salaire"], s[0]["primes_toutes"]) == (700, 100)
    assert (s[1]["salaire"], s[1]["primes_toutes"]) == (300, 0)
    assert s[2]["salaire"] is None and s[2]["primes_toutes"] is None
    assert r["salaire_cumul"]["m"] == 1000 and r["salaire_cumul"]["m1"] is None
    assert r["primes_toutes_cumul"]["m"] == 100


def test_exclusion_changeant_en_cours_d_annee():
    sans = frozenset()  # janvier : Primes sur ventes comptée ; février : exclue
    def p(excl, **m):
        return PeriodeData((L(1, **m),), excl)
    n = {1: p(sans, Brut_Réel=1000, Primes_sur_ventes=30), 2: p(EXCL, Brut_Réel=1000, Primes_sur_ventes=30)}
    n1 = {1: p(sans, Brut_Réel=1000, Primes_sur_ventes=30), 2: p(sans, Brut_Réel=1000, Primes_sur_ventes=30)}
    r = annuel(n, n1, 2, REFS_F, Params())
    total = next(x for x in r["a_type_charge"] if x["rubrique"] == "TOTAL CHARGES")
    assert total["m"] == 2030 and total["m1"] == 2060
    m = mensuel(n[2], n[1], REFS_F, Params(),
                Budgets(rubrique={"Charges Patronales": D(10)}))
    t = next(x for x in m["a_type_charge"] if x["rubrique"] == "TOTAL CHARGES")
    assert t["m1"] == m["synthese"]["ms"]["m1"] == 1030  # N-1 avec ses propres exclusions
