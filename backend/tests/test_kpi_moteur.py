from decimal import Decimal as D

from hypothesis import given, settings
from hypothesis import strategies as st

from app.kpi import formules as f
from app.kpi.moteur import Ligne, Params, PeriodeData, Refs, annuel, individuel, mensuel

REFS = Refs(
    services=("SAV PL", "Commerce VN"), activites=("Front office", "Back Office"),
    sites=("Douala", "Yaoundé"), contrats=("CDI", "CDD", "MAD"),
    rubriques=("Absences (nb)", "Brut Réel", "Primes sur ventes", "Commission"))
EXCL = frozenset({"Absences (nb)", "Primes sur ventes"})


def L(sid, service="SAV PL", site="Douala", act="Front office", ctr="CDI", **m):
    noms = {"Absences_nb": "Absences (nb)"}
    return Ligne(sid, service, site, act, ctr,
                 {noms.get(k, k.replace("_", " ")): D(v) for k, v in m.items()})


def pd(*lignes, ca=None):
    return PeriodeData(tuple(lignes), EXCL, None if ca is None else D(ca))


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
    assert f.marge(D(100), D(60)) == 40 and f.marge(None, D(60)) is None  # jamais 0 sans CA
    assert f.taux_marge(D(100), D(60)) == D("0.4")
    assert f.taux_marge(D(0), D(60)) == f.NA and f.taux_marge(None, D(1)) is None
    assert f.moyenne(D(90), 3) == 30 and f.moyenne(D(0), 0) is None


# ---------- mensuel ----------
def test_total_charges_exclut_les_rubriques_exclues_et_vide_vaut_zero():
    p = pd(L(1, Brut_Réel=1000, Absences_nb=3, Primes_sur_ventes=500), L(2, Commission=50))
    assert p.total(p.lignes[0]) == 1000 and p.total(p.lignes[1]) == 50 and p.ms == 1050


def test_mensuel_valeurs_et_absence_de_m1():
    cur = pd(L(1, Brut_Réel=1000, Absences_nb=2), L(2, ctr="CDD", Brut_Réel=500, Absences_nb=1),
             ca=2000)
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
    assert next(x for x in r["d_contrat"]["ventilation"]
                if (x["contrat"], x["activite"]) == ("MAD", "Back Office"))["m"] == 1
    assert r["a_type_charge"][-1] == {"rubrique": "TOTAL CHARGES", "m1": None, "m": 140,
                                      "var": None, "var_pct": None}


def test_controle_bloquant_si_referentiel_incomplet():
    cur = pd(L(1, ctr="Stagiaire", Brut_Réel=10))  # contrat hors référentiel
    cs = {c["controle"]: c for c in mensuel(cur, None, REFS, Params())["controles"]}
    assert cs["Total contrats = CDI + CDD + MAD"]["bloquant"]


def test_regle_datee_changeant_le_total():
    ligne = L(1, Brut_Réel=100, Primes_sur_ventes=50)
    assert PeriodeData((ligne,), frozenset()).ms == 150
    assert PeriodeData((ligne,), EXCL).ms == 100


# ---------- annuel / individuel ----------
def test_annuel_cumul_moyenne_nb_mois_et_marge_ytd():
    n = {1: pd(L(1, Brut_Réel=100), ca=300), 2: pd(L(1, Brut_Réel=200)),
         4: pd(L(1, Brut_Réel=300), ca=500)}
    n1 = {1: pd(L(1, Brut_Réel=50)), 2: pd(L(1, Brut_Réel=50))}
    r = annuel(n, n1, 4, REFS, Params())
    assert r["cumul_ytd"]["m"] == 600 and r["cumul_ytd"]["nb_mois"] == 3
    assert r["cumul_ytd"]["m1"] == 100 and r["cumul_ytd"]["nb_mois_n1"] == 2
    assert r["moyenne_mensuelle"]["m"] == 200
    assert r["marge_ytd"] == (300 - 100) + (500 - 300) and r["nb_mois_marge"] == 2
    assert r["serie_n"][2]["ms"] is None and r["serie_n"][3]["ms"] == 300  # mars vide
    r2 = annuel(n, n1, 2, REFS, Params())
    assert r2["cumul_ytd"]["m"] == 300 and r2["marge_ytd"] == 200


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
