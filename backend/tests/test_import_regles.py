import io
import os
import time
from pathlib import Path

import pytest
from openpyxl import Workbook

from app.imports.lecture import FichierIllisible, lire, norm
from app.imports.regles import ATTRIBUTS, BLOQUANT, Refs, valider
from app.referentiels_init import ACTIVITES, CONTRATS, RUBRIQUES, SERVICES, SITES

ENTETES = ATTRIBUTS + [r for r, _ in RUBRIQUES]
V4 = Path(os.environ.get("V4_XLSX", Path(__file__).parents[3] / "Reporting RH" / "REPORTING_RH_V4.xlsx"))


def idx(vals):
    return {norm(v): v for v in vals}


def refs(**kw) -> Refs:
    base = dict(services=idx(SERVICES), activites=idx(ACTIVITES), sites=idx(SITES),
                contrats=idx(CONTRATS), rubriques=list(RUBRIQUES),
                rubrique_alias={"variable": "Commission"})
    base.update(kw)
    return Refs(**base)


def xlsx(lignes, entetes=ENTETES, avant=0) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "DONNEES"
    for _ in range(avant):
        ws.append(["titre"])
    ws.append(entetes)
    for ligne in lignes:
        ws.append(ligne)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def ligne(**kw):
    base = {"ANNÉE": 2026, "MOIS": "Janvier", "MATRICULE": "EMP001", "Noms": "A B", "Poste": "P",
            "Type Contrat": "CDI", "Activité": "Front office", "Site": "Douala", "Service": "SAV PL"}
    base.update(kw)
    return [base.get(e) for e in ENTETES]


def run(lignes, entetes=ENTETES, avant=0, **kw):
    f = lire(xlsx(lignes, entetes, avant))
    L, anos, st = valider(f, refs(**kw))
    return L, {(a.ligne, a.colonne, a.code) for a in anos}, anos, st


def test_fichier_propre():
    L, ens, anos, st = run([ligne(), ligne(MATRICULE="EMP002", Noms="C D")])
    assert not [a for a in anos if a.gravite == BLOQUANT]
    assert st["lignes"] == 2 and st["salaries"] == 2 and not any(x.bloquant for x in L)
    assert ens == {(2, "Poste", "POSTE_NOUVEAU")}


def test_pieges_ensemble_exact_ligne_colonne_code():
    rows = [
        ligne(MATRICULE="E1"), ligne(MATRICULE="E1"),                               # 2,3 doublon
        ligne(MATRICULE="E2", Service="Inconnu"),                                   # 4
        ligne(MATRICULE="E3", **{"Primes sur ventes": "abc"}),                      # 5
        ligne(MATRICULE="E4", Bonus="#N/A"),                                        # 6
        ligne(MATRICULE="E5", MOIS="  fevrier "),                                   # 7
        ligne(MATRICULE="E6 "),                                                # 8
        ligne(MATRICULE=7),                                                         # 9
        ligne(MATRICULE="E8", **{"Absences (nb)": 40}),                             # 10
        ligne(MATRICULE="E9", ANNÉE="x"),                                           # 11
        ligne(MATRICULE="E10", Formation="1 200,5"),                                # 12
        ligne(MATRICULE="E11", Formation=-5),                                       # 13
        ligne(MATRICULE="E12", Formation="1.200,5"),                                # 14 ambigu
        ligne(MATRICULE="E 13"),                                                    # 15 espace
        ligne(MATRICULE="E14", Formation=10**15),                                   # 16 bornes
        ligne(MATRICULE="E15", MOIS="Mars"),                                        # 17 close
        ligne(MATRICULE="E16", Formation="1.23456"),                                # 18 précision
    ]
    L, ens, anos, _ = run(rows, postes={"p"}, periodes_closes={(2026, 3)})
    assert ens == {
        (2, "ANNÉE+MOIS+MATRICULE", "DOUBLON"), (3, "ANNÉE+MOIS+MATRICULE", "DOUBLON"),
        (4, "Service", "REFERENTIEL_INCONNU"),
        (5, "Primes sur ventes", "NON_NUMERIQUE"),
        (6, "Bonus", "ERREUR_EXCEL"),
        (7, "MOIS", "NORMALISE"),
        (8, "MATRICULE", "NORMALISE"),
        (9, "MATRICULE", "MATRICULE_NUMERIQUE"),
        (10, "Absences (nb)", "ABSENCES_HORS_BORNES"),
        (11, "ANNÉE", "ANNEE_INVALIDE"),
        (12, "Formation", "TEXTE_CONVERTI"),
        (13, "Formation", "MONTANT_NEGATIF"),
        (14, "Formation", "NON_NUMERIQUE"),
        (15, "MATRICULE", "MATRICULE_ESPACE"),
        (16, "Formation", "MONTANT_HORS_BORNES"),
        (17, "MOIS", "PERIODE_CLOSE"),
        (18, "Formation", "PRECISION_TRONQUEE"),
        (18, "Formation", "TEXTE_CONVERTI"),
    }
    bloq = {x.num for x in L if x.bloquant}
    assert bloq == {2, 3, 4, 5, 6, 10, 11, 14, 15, 16, 17}
    by = {x.num: x for x in L}
    assert str(by[12].montants["Formation"]) == "1200.500"
    assert str(by[18].montants["Formation"]) == "1.235"


def test_alias_variable():
    ent = ["Variable" if e == "Commission" else e for e in ENTETES]
    row = ligne(Commission=5)
    _, ens, anos, _ = run([row], ent, postes={"p"})
    assert ens == {(1, "Variable", "ENTETE_ALIAS")}


def test_entete_manquant_et_inconnu():
    _, ens, _, st = run([], [e for e in ENTETES if e != "Site"] + ["TOTAL CHARGES"])
    assert ens == {(1, "Site", "ENTETE_MANQUANT"), (1, "TOTAL CHARGES", "ENTETE_INCONNU")}
    assert st["lignes"] == 0


def test_entete_en_ligne_3_et_numeros_de_ligne_reels():
    _, ens, _, _ = run([ligne(Service="Zut")], avant=2)
    assert (4, "Service", "REFERENTIEL_INCONNU") in ens


def test_fichier_vide_et_illisible():
    _, ens, _, _ = run([])
    assert (2, "DONNEES", "FICHIER_VIDE") in ens
    with pytest.raises(FichierIllisible):
        lire(b"pas un xlsx")
    with pytest.raises(FichierIllisible):
        lire(xlsx([], ["a", "b"]))


def test_mutation_et_nom_incoherent_avec_base():
    _, ens, _, _ = run([ligne(), ligne(MOIS="Février", Service="Pneumatique")], postes={"p"},
                       noms_connus={"emp001": "autre nom"})
    assert (2, "Service", "MUTATION") in ens and (2, "Noms", "NOM_INCOHERENT") in ens


@pytest.mark.skipif(not V4.exists(), reason="V4 non versionné")
def test_v4_reel_1398_lignes_0_bloquant():
    t = time.time()
    f = lire(V4.read_bytes())
    assert f.entete_ligne == 3
    L, anos, st = valider(f, refs())
    assert st["lignes"] == 1398 and st["salaries"] == 90 and st["periodes"] == 18
    assert not [a for a in anos if a.gravite == BLOQUANT], [a for a in anos if a.gravite == BLOQUANT][:5]
    assert time.time() - t < 30
