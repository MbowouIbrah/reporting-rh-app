"""Tests du contrôle d'import : un fichier propre passe, chaque piège produit son anomalie."""
import sys
from pathlib import Path

from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).resolve().parent))
from valider_import import BLOQUANT, ENTETES, valider  # noqa: E402


def fichier(tmp_path, lignes, entetes=ENTETES):
    wb = Workbook()
    ws = wb.active
    ws.title = "DONNEES"
    ws.append(entetes)
    for l in lignes:
        ws.append(l)
    p = tmp_path / "t.xlsx"
    wb.save(p)
    return p


def ligne(**kw):
    base = {"ANNÉE": 2026, "MOIS": "Janvier", "MATRICULE": "EMP001", "Noms": "A B", "Poste": "P",
            "Type Contrat": "CDI", "Activité": "Front office", "Site": "Douala", "Service": "SAV PL"}
    base.update(kw)
    return [base.get(e) for e in ENTETES]


def codes(rap, gravite=None):
    return {a[2] for a in rap.lignes if gravite is None or a[3] == gravite}


def test_fichier_propre(tmp_path):
    rap, st = valider(fichier(tmp_path, [ligne(), ligne(MATRICULE="EMP002", Noms="C D")]))
    assert rap.compte(BLOQUANT) == 0 and st["lignes"] == 2 and st["salaries"] == 2


def test_pieges(tmp_path):
    rows = [
        ligne(MATRICULE="E1"), ligne(MATRICULE="E1"),                       # doublon
        ligne(MATRICULE="E2", Service="Inconnu"),                           # référentiel
        ligne(MATRICULE="E3", **{"Primes sur ventes": "abc"}),              # texte
        ligne(MATRICULE="E4", **{"Bonus": "#N/A"}),                         # erreur excel
        ligne(MATRICULE="E5", MOIS="  fevrier "),                           # normalisé
        ligne(MATRICULE="E6\u00a0"),                                        # nbsp
        ligne(MATRICULE=7),                                                 # numérique
        ligne(MATRICULE="E8", **{"Absences (nb)": 40}),                     # bornes
        ligne(MATRICULE="E9", ANNÉE="x"),                                   # année
        ligne(MATRICULE="E10", **{"Formation": "1 200,5"}),                 # converti
        ligne(MATRICULE="E11", **{"Formation": -5}),                        # négatif
    ]
    rap, _ = valider(fichier(tmp_path, rows))
    b = codes(rap, BLOQUANT)
    assert {"DOUBLON", "REFERENTIEL_INCONNU", "NON_NUMERIQUE", "ERREUR_EXCEL",
            "ABSENCES_HORS_BORNES", "ANNEE_INVALIDE"} <= b
    a = codes(rap)
    assert {"NORMALISE", "MATRICULE_NUMERIQUE", "TEXTE_CONVERTI", "MONTANT_NEGATIF"} <= a
    loc = {(x[0], x[2]) for x in rap.lignes}
    assert (4, "REFERENTIEL_INCONNU") in loc and (2, "DOUBLON") in loc and (3, "DOUBLON") in loc


def test_entete_manquant_et_alias(tmp_path):
    ent = [("Variable" if e == "Commission" else e) for e in ENTETES]
    rap, _ = valider(fichier(tmp_path, [ligne()], ent))
    assert "ENTETE_ALIAS" in codes(rap) and rap.compte(BLOQUANT) == 0
    rap, _ = valider(fichier(tmp_path, [], [e for e in ENTETES if e != "Site"]))
    assert "ENTETE_MANQUANT" in codes(rap, BLOQUANT)


def test_mutation(tmp_path):
    rap, _ = valider(fichier(tmp_path, [ligne(), ligne(MOIS="Février", Service="Pneumatique")]))
    assert "MUTATION" in codes(rap) and rap.compte(BLOQUANT) == 0
