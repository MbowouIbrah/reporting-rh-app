import io
import os
import re
import time
import zipfile
from decimal import Decimal
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
    L, ens, anos, st = run([ligne(Bonus=5), ligne(MATRICULE="EMP002", Noms="C D", Bonus=5)])
    assert not [a for a in anos if a.gravite == BLOQUANT]
    assert st["lignes"] == 2 and st["salaries"] == 2 and not any(x.bloquant for x in L)
    assert ens == {(2, "Poste", "POSTE_NOUVEAU")}


def test_pieges_ensemble_exact_ligne_colonne_code():
    rows = [
        ligne(MATRICULE="E1"), ligne(MATRICULE="E1"),                               # 2,3 doublon
        ligne(MATRICULE="E2", Service="Inconnu"),                                   # 4
        ligne(MATRICULE="E3", **{"Primes sur ventes": "abc"}),                      # 5
        ligne(MATRICULE="E4"),                                                      # 6
        ligne(MATRICULE="E5", MOIS="  fevrier "),                                   # 7
        ligne(MATRICULE="E6 "),                                                # 8
        ligne(MATRICULE=7),                                                         # 9
        ligne(MATRICULE="E8", **{"Absences (nb)": 40}),                             # 10
        ligne(MATRICULE="E9", ANNÉE="x"),                                           # 11
        ligne(MATRICULE="E10", Formation="1 200,5"),                                # 12
        ligne(MATRICULE="E11", Formation=-5),                                       # 13
        ligne(MATRICULE="E12", Formation="1.200,5"),                                # 14 milliers + décimales
        ligne(MATRICULE="E 13"),                                                    # 15 espace
        ligne(MATRICULE="E14", Formation=10**15),                                   # 16 bornes
        ligne(MATRICULE="E15", MOIS="Mars"),                                        # 17 autre mois
        ligne(MATRICULE="E16", Formation="1.23456"),                                # 18 précision
    ]
    L, ens, anos, _ = run(rows, postes={"p"})
    ens = {e for e in ens if e[2] != "LIGNE_SANS_MONTANT"}  # lignes de test sans montant
    assert ens == {
        (2, "MATRICULE", "DOUBLON"),
        (4, "Service", "REFERENTIEL_INCONNU"),
        (5, "Primes sur ventes", "NON_NUMERIQUE"),
        (7, "MOIS", "NORMALISE"),
        (7, "MOIS", "PERIODE_ISOLEE"), (17, "MOIS", "PERIODE_ISOLEE"),
        (8, "MATRICULE", "NORMALISE"),
        (9, "MATRICULE", "MATRICULE_NUMERIQUE"),
        (10, "Absences (nb)", "ABSENCES_HORS_BORNES"),
        (11, "ANNÉE", "ANNEE_INVALIDE"),
        (12, "Formation", "TEXTE_CONVERTI"),
        (13, "Formation", "MONTANT_NEGATIF"),
        (14, "Formation", "TEXTE_CONVERTI"),
        (15, "MATRICULE", "MATRICULE_ESPACE"),
        (16, "Formation", "MONTANT_HORS_BORNES"),
        (18, "Formation", "TEXTE_CONVERTI"),
    }
    bloq = {x.num for x in L if x.bloquant}
    assert bloq == {2, 3, 4, 5, 10, 11, 15, 16}
    by = {x.num: x for x in L}
    assert by[12].montants["Formation"] == Decimal("1200.5")
    assert by[18].montants["Formation"] == Decimal("1.23456")


def test_tirets_et_mots_lus_comme_vides():
    rows = [
        ligne(MATRICULE="E2", Bonus=" - "),                                         # 2
        ligne(MATRICULE="E3", Formation="néant", Bonus="N/A", **{"Absences (nb)": "/"}),  # 3
        [("#N/A" if e == "Noms" else "=A6" if e == "Bonus" else None) for e in ENTETES],  # 4 formules prolongées
    ]
    L, ens, anos, st = run(rows, postes={"p"})
    assert ens == {(2, "Bonus", "SANS_MONTANT"), (3, "Formation", "SANS_MONTANT"), (3, "Bonus", "SANS_MONTANT"),
                   (3, "Absences (nb)", "SANS_MONTANT"), (2, "Primes sur ventes", "LIGNE_SANS_MONTANT"),
                   (3, "Primes sur ventes", "LIGNE_SANS_MONTANT")}
    assert st["lignes"] == 2 and not any(x.bloquant for x in L)
    assert all("Formation" not in x.montants and "Bonus" not in x.montants for x in L)


def test_formules_sans_valeur_refusent_le_fichier_avant_tout():
    rows = [
        ligne(MATRICULE="E1", MOIS="#N/A", Service="Inconnu"),                      # 2 erreur sans formule
        ligne(MATRICULE="E2", Formation="=B3*2"),                                   # 3 formule jamais calculée
        ligne(MATRICULE="E4", Formation="#VALEUR!"),                                # 4 collé en texte (fr)
        ligne(MATRICULE="E1"),                                                      # 5 doublon : pas encore contrôlé
    ]
    L, ens, anos, st = run(rows, postes={"p"})
    assert ens == {(2, "MOIS", "ERREUR_EXCEL"), (3, "Formation", "FORMULE_SANS_VALEUR"), (4, "Formation", "ERREUR_EXCEL")}
    assert L == [] and st == {"lignes": 0} and all(a.gravite == BLOQUANT for a in anos)
    assert next(a for a in anos if a.code == "FORMULE_SANS_VALEUR").valeur == "=B3*2"


def calcule(contenu: bytes, valeurs: dict[str, str]) -> bytes:
    """Pose la valeur calculée de chaque formule comme Excel l'enregistre (<v> à côté de <f>, t="e" pour une erreur)."""
    src = zipfile.ZipFile(io.BytesIO(contenu))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for n in src.namelist():
            d = src.read(n)
            if n == "xl/worksheets/sheet1.xml":
                for f, v in valeurs.items():
                    t = b' t="e"' if v.startswith("#") else b""
                    fx = re.escape(f.encode())
                    d = re.sub(rb'(<c r="[A-Z]+\d+")(>)<f>' + fx + rb"</f>(?:<v\s*/>|<v></v>)?",
                               rb"\1" + t + rb"\2<f>" + f.encode() + rb"</f><v>" + v.encode() + rb"</v>", d)
            z.writestr(n, d)
    return out.getvalue()


def test_liaison_externe():
    rows = [ligne(MATRICULE="E1", Formation="='[1]Paie'!C2"), ligne(MATRICULE="E2", Bonus="=[1]Paie!D3")]
    ok = calcule(xlsx(rows), {"'[1]Paie'!C2": "1500", "[1]Paie!D3": "20"})
    L, anos = valider(lire(ok), refs(postes={"p"}))[:2]
    assert [(a.ligne, a.colonne, a.code, a.gravite, a.valeur) for a in anos] == [
        (2, "Formation", "LIAISON_EXTERNE", "avertissement", "='[1]Paie'!C2"),
        (3, "Bonus", "LIAISON_EXTERNE", "avertissement", "=[1]Paie!D3")]
    assert "Valeur lue : 1500" in anos[0].message and str(L[0].montants["Formation"]) == "1500.000"
    ko = calcule(xlsx(rows), {"'[1]Paie'!C2": "#REF!", "[1]Paie!D3": "20"})
    L, anos = valider(lire(ko), refs(postes={"p"}))[:2]
    assert L == [] and [(a.ligne, a.colonne, a.code, a.valeur) for a in anos] == [
        (2, "Formation", "LIAISON_ERREUR", "='[1]Paie'!C2")]
    assert "#REF!" in anos[0].message


def test_formule_en_erreur():
    ko = calcule(xlsx([ligne(Formation="=1/0")]), {"1/0": "#DIV/0!"})
    anos = valider(lire(ko), refs(postes={"p"}))[1]
    assert [(a.code, a.valeur, a.message) for a in anos] == [("ERREUR_EXCEL", "=1/0", "La formule donne l'erreur #DIV/0!.")]


def test_formule_calculee_lue_par_sa_valeur():
    wb = Workbook()
    ws = wb.active
    ws.title = "DONNEES"
    ws.append(ENTETES)
    ws.append(ligne(Formation="=1+1"))
    buf = io.BytesIO()
    wb.save(buf)
    # Valeur calculée posée comme Excel l'enregistre (<v> à côté de <f>).
    src = zipfile.ZipFile(io.BytesIO(buf.getvalue()))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for n in src.namelist():
            d = src.read(n)
            if n == "xl/worksheets/sheet1.xml":
                d = re.sub(rb"<f>1\+1</f><v\s*/>|<f>1\+1</f>(<v></v>)?", b"<f>1+1</f><v>2</v>", d)
            z.writestr(n, d)
    L, anos = valider(lire(out.getvalue()), refs(postes={"p"}))[:2]
    assert str(L[0].montants["Formation"]) == "2.000" and not [a for a in anos if a.code == "FORMULE_SANS_VALEUR"]


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


def test_feuille_donnees_excel_v5_colonnes_calculees_ignorees():
    """Fichier REPORTING RH tel quel : titre, consigne, colonnes calculées après TVA & Marge MAD,
    formules prolongées sous les données ; plusieurs mois."""
    calc = ["TOTAL CHARGES (FCFA)", "Total exclusions (technique)", "MOIS (norme)",
            "MATRICULE (norme)", "Service (norme)"]
    rows = [ligne() + [1000, 0, "janvier", "emp001", "sav pl"],
            ligne(MOIS="Février") + [1000, 0, "fevrier", "emp001", "sav pl"],
            [None] * len(ENTETES) + [0, 0, "", "", ""]]
    L, ens, anos, st = run(rows, ENTETES + calc, avant=2)
    assert not [a for a in anos if a.code.startswith("ENTETE")]
    assert st["lignes"] == 2 and st["periodes"] == 2 and not any(x.bloquant for x in L)


def test_formules_prolongees_comptees_comme_lignes_vides():
    """Les lignes où seules les colonnes calculées ont une valeur ne sont pas chargées et la
    lecture s'arrête après MAX_LIGNES_VIDES d'entre elles."""
    from app.imports.lecture import MAX_LIGNES_VIDES

    calc = ["TOTAL CHARGES (FCFA)", "MOIS (norme)"]
    formules = [[None] * len(ENTETES) + [0, ""]] * (MAX_LIGNES_VIDES + 10)
    f = lire(xlsx([ligne() + [1000, "janvier"], *formules, ligne(MOIS="Février") + [0, ""]],
                  ENTETES + calc, avant=2))
    assert [n for n, _ in f.lignes] == [4] and f.ligne_ignoree == 4 + MAX_LIGNES_VIDES + 11


def test_donnees_apres_lignes_vides_bloquantes_et_colonne_inconnue_ignoree():
    """Un bloc séparé par 50 lignes vides n'est pas perdu en silence ; une colonne inconnue
    recopiée vers le bas ne prolonge pas la lecture (même règle « vide » que les règles)."""
    from app.imports.lecture import MAX_LIGNES_VIDES
    from app.imports.regles import entetes_reconnus

    vides = [[None] * len(ENTETES) + ["note"]] * MAX_LIGNES_VIDES
    contenu = xlsx([ligne(), *vides, ligne(MOIS="Février")], ENTETES + ["Commentaire"])
    f = lire(contenu, entetes_reconnus(refs()))
    assert [n for n, _ in f.lignes] == [2] and f.ligne_ignoree == 3 + MAX_LIGNES_VIDES
    _, anos, _ = valider(f, refs(postes={"p"}))
    assert (f.ligne_ignoree, "LIGNES_IGNOREES", BLOQUANT) in {(a.ligne, a.code, a.gravite) for a in anos}


def test_entete_en_double_bloquant_sans_faux_alias():
    ent = ENTETES + ["Variable"]
    _, ens, anos, _ = run([ligne(Commission=5) + [7]], ent, postes={"p"})
    assert ens == {(1, "Variable", "ENTETE_DOUBLON")}
    assert "colonne " in anos[0].message and anos[0].gravite == BLOQUANT


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
    assert (3, "Service", "MUTATION") in ens and (2, "Noms", "NOM_INCOHERENT") in ens


def test_mutation_comparee_au_mois_enregistre_phrase_complete():
    _, ens, anos, _ = run([ligne(MOIS="Février", Noms="Didier Nkolo", Service="Pneumatique")],
                          postes={"p"}, historique={"emp001": [(2025, 12, {"Service": "SAV PL"}),
                                                               (2026, 1, {"Service": "SAV PL"})]})
    a = next(a for a in anos if a.code == "MUTATION")
    assert (a.ligne, a.colonne, a.valeur) == (2, "Service", "Pneumatique")
    assert "Didier Nkolo" in a.message and "« SAV PL » (janvier 2026, déjà enregistré)" in a.message
    assert "« Pneumatique » (février 2026)" in a.message


def test_mutation_un_point_par_changement():
    _, ens, _, _ = run([ligne(), ligne(MOIS="Février", Service="Pneumatique"),
                        ligne(MOIS="Mars", Service="Pneumatique"), ligne(MOIS="Avril", Service="SAV PL")],
                       postes={"p"})
    muts = {e for e in ens if e[2] == "MUTATION"}
    assert muts == {(3, "Service", "MUTATION"), (5, "Service", "MUTATION")}


@pytest.mark.skipif(not V4.exists(), reason="V4 non versionné")
def test_v4_reel_1398_lignes_0_bloquant():
    t = time.time()
    f = lire(V4.read_bytes())
    assert f.entete_ligne == 3
    L, anos, st = valider(f, refs())
    assert st["lignes"] == 1398 and st["salaries"] == 90 and st["periodes"] == 18
    assert not [a for a in anos if a.gravite == BLOQUANT], [a for a in anos if a.gravite == BLOQUANT][:5]
    assert time.time() - t < 30


def test_noms_proches_sans_tenir_compte_des_espaces_ni_de_l_ordre():
    ann = {"emp001": ("EMP001", "Jean Dupont"), "emp009": ("EMP009", "Awa Ngono")}
    connus = {"emp001": "jean dupont", "emp009": "awa ngono"}
    # même matricule, faute de frappe : proche ; espaces parasites et casse : aucune alerte
    _, ens, _, _ = run([ligne(Noms="Jean Dupond")], postes={"p"}, noms_connus=connus, annuaire=ann)
    assert (2, "Noms", "NOM_PROCHE") in ens
    _, ens, _, _ = run([ligne(Noms="  JEAN   dupont ")], postes={"p"}, noms_connus=connus, annuaire=ann)
    assert not any(c == "Noms" for _, c, _ in ens)
    # nom sans rapport : incohérent
    _, ens, _, _ = run([ligne(Noms="Zoe Martin")], postes={"p"}, noms_connus=connus, annuaire=ann)
    assert (2, "Noms", "NOM_INCOHERENT") in ens


def test_nouveau_matricule_dont_le_nom_existe_deja():
    ann = {"emp009": ("EMP009", "Awa Ngono")}
    _, ens, anos, _ = run([ligne(MATRICULE="EMP090", Noms="Ngono  Awa")], postes={"p"},
                          noms_connus={"emp009": "awa ngono"}, annuaire=ann)
    assert (2, "Noms", "NOM_SIMILAIRE") in ens
    assert "EMP009" in next(a.message for a in anos if a.code == "NOM_SIMILAIRE")
    _, ens, _, _ = run([ligne(MATRICULE="EMP090", Noms="Paul Biya")], postes={"p"},
                       noms_connus={"emp009": "awa ngono"}, annuaire=ann)
    assert not any(code == "NOM_SIMILAIRE" for *_, code in ens)


def test_employe_sans_matricule_identifie_par_son_nom():
    # nom nettoyé : retrouve la fiche existante ; inconnu : identifiant technique stable
    ann = {"sm-abc": ("SM-ABC", "Awa Ngono")}
    L, ens, _, _ = run([ligne(MATRICULE=None, Noms="  AWA  ngono ")], postes={"p"},
                       noms_connus={"sm-abc": "awa ngono"}, annuaire=ann)
    assert L[0].matricule == "SM-ABC" and not any(c == "MATRICULE" for _, c, _ in ens)
    L1, _, _, _ = run([ligne(MATRICULE=None, Noms="Paul Biya")], postes={"p"})
    L2, _, _, _ = run([ligne(MATRICULE=None, Noms="paul  BIYA")], postes={"p"})
    assert L1[0].matricule.startswith("SM-") and L1[0].matricule == L2[0].matricule
    # ni matricule ni nom : bloquant ; homonymes : bloquant
    _, ens, _, _ = run([ligne(MATRICULE=None, Noms=None)], postes={"p"})
    assert (2, "MATRICULE", "VALEUR_MANQUANTE") in ens
    _, ens, _, _ = run([ligne(MATRICULE=None, Noms="Awa Ngono")], postes={"p"},
                       noms_connus={"e1": "awa ngono", "e2": "awa ngono"},
                       annuaire={"e1": ("E1", "Awa Ngono"), "e2": ("E2", "Awa Ngono")})
    assert (2, "MATRICULE", "NOM_HOMONYME") in ens


def test_lecture_des_nombres_mal_ecrits():
    from decimal import Decimal

    from app.imports.regles import fr, interpretations
    assert fr(Decimal("1250000.5")) == "1 250 000,5" and fr(Decimal("-45")) == "-45"
    assert fr(Decimal("433674.000")) == "433 674" and fr(Decimal("138700.4850")) == "138 700,485"
    assert interpretations("1.250.000") == [(Decimal("1250000"), "Corriger en 1 250 000")]
    assert interpretations("1,250,000.50")[0][0] == Decimal("1250000.50")
    assert interpretations("25 000 FCFA")[0][0] == Decimal("25000")
    assert interpretations("25000 F")[0][0] == Decimal("25000")
    assert interpretations("3 jours")[0][0] == Decimal("3")
    assert [d for d, _ in interpretations("45.000")] == [Decimal("45000"), Decimal("45.000")]
    assert interpretations("45.000")[1][1] == "45 (le point sépare les décimales)"
    assert interpretations("abc") == [] and interpretations("1.2.3") == [] and interpretations(12) == []

    rows = [ligne(MATRICULE="E1", Formation="45.000"), ligne(MATRICULE="E2", Formation="1.250.000"),
            ligne(MATRICULE="E3", Formation="138700.4853"), ligne(MATRICULE="E4", Noms="Jean  Dupont")]
    L, ens, anos, _ = run(rows, postes={"p"})
    msg = {(a.ligne, a.code): a.message for a in anos}
    assert (2, "Formation", "SEPARATEUR_AMBIGU") in ens
    assert msg[(2, "SEPARATEUR_AMBIGU")] == ("« 45.000 » : le point peut séparer les milliers (45 000) "
                                            "ou les décimales (45). Choisir la bonne lecture.")
    # Intention évidente : lue d'office, simple point d'attention, la ligne n'est pas bloquée.
    assert msg[(3, "TEXTE_CONVERTI")] == "« 1.250.000 » lu 1 250 000 : les séparateurs de milliers ne sont pas gardés."
    assert {x.num: x for x in L}[3].montants["Formation"] == Decimal("1250000") and not {x.num: x for x in L}[3].bloquant
    L2, _, anos2, _ = run([ligne(MATRICULE="E5", Formation="25 000 FCFA")], postes={"p"})
    assert [a.message for a in anos2 if a.code == "TEXTE_CONVERTI"] == [
        "« 25 000 FCFA » lu 25 000 : un montant est un nombre seul, « FCFA » n'est pas gardé."]
    assert L2[0].montants["Formation"] == Decimal("25000") and not L2[0].bloquant
    # Décimales gardées telles qu'elles viennent, sans point d'attention.
    assert {x.num: x for x in L}[4].montants["Formation"] == Decimal("138700.4853") and (4, "Formation", "PRECISION_TRONQUEE") not in ens
    assert not any(c == "Noms" for _, c, _ in ens) and {x.num: x for x in L}[5].nom == "Jean Dupont"


def test_matricule_douteux_retrouve_l_employe_connu():
    ann = {"emp020": ("EMP020", "Noel Essomba"), "emp046": ("EMP046", "Awa Ngono")}
    connus = {"emp020": "noel essomba", "emp046": "awa ngono"}
    # « 20 » : mêmes chiffres et même nom qu'EMP020 ; plus de point « matricule numérique »
    _, ens, anos, _ = run([ligne(MATRICULE=20, Noms="Noel Essomba")], postes={"p"},
                          noms_connus=connus, annuaire=ann)
    assert (2, "MATRICULE", "MATRICULE_DOUTEUX") in ens
    assert not any(code == "MATRICULE_NUMERIQUE" for *_, code in ens)
    assert "Noel Essomba (EMP020)" in next(a.message for a in anos if a.code == "MATRICULE_DOUTEUX")
    # mêmes chiffres mais autre personne : pas de rapprochement
    _, ens, _, _ = run([ligne(MATRICULE=20, Noms="Paul Biya")], postes={"p"},
                       noms_connus=connus, annuaire=ann)
    assert not any(code == "MATRICULE_DOUTEUX" for *_, code in ens)
    # casse différente d'un matricule connu : repris tel qu'enregistré
    L, ens, _, _ = run([ligne(MATRICULE="emp046", Noms="Awa Ngono")], postes={"p"},
                       noms_connus=connus, annuaire=ann)
    assert (2, "MATRICULE", "NORMALISE") in ens and L[0].matricule == "EMP046"
    assert not any(code == "MATRICULE_DOUTEUX" for *_, code in ens)


def _codes(anos, code):
    return [(a.ligne, a.colonne) for a in anos if a.code == code]


def test_periode_isolee_signalee():
    rows = [ligne(MATRICULE=f"E{i}", Noms=f"N {i}", Formation=10) for i in range(11)]
    rows.append(ligne(MATRICULE="E99", Noms="Z Z", MOIS="Juillet", Formation=10))
    _, _, anos, _ = run(rows)
    assert _codes(anos, "PERIODE_ISOLEE") == [(13, "MOIS")]


def test_montant_x10_et_milliers_par_rapport_au_mois_precedent_du_fichier():
    rows = [ligne(Bonus=1000, Formation=500), ligne(MOIS="Février", Bonus=10000, Formation="0,5")]
    _, _, anos, _ = run(rows)
    assert {a.code for a in anos if a.ligne == 3} >= {"MONTANT_X10", "MONTANT_MILLIERS"}


def test_brut_reel_different_de_la_somme():
    rows = [ligne(**{"Salaire brut garantie": 1000, "Bonus": 200, "Brut Réel": 1200}),
            ligne(MATRICULE="EMP002", Noms="C D", **{"Salaire brut garantie": 1000, "Brut Réel": 1500})]
    _, _, anos, _ = run(rows)
    assert _codes(anos, "BRUT_REEL_ECART") == [(3, "Brut Réel")]


def test_ligne_sans_montant_et_employe_sans_matricule():
    rows = [ligne(Formation=10), ligne(MATRICULE="EMP002", Noms="C D"), ligne(MATRICULE=None, Noms="X Y", Bonus=5)]
    _, _, anos, _ = run(rows)
    assert [n for n, _ in _codes(anos, "LIGNE_SANS_MONTANT")] == [3]
    assert _codes(anos, "SANS_MATRICULE") == [(4, "MATRICULE")]


def test_ecart_signale_ne_sert_pas_de_base_au_mois_suivant():
    rows = [ligne(Bonus=1000), ligne(MOIS="Février", Bonus=10000), ligne(MOIS="Mars", Bonus=1000)]
    _, _, anos, _ = run(rows)
    assert _codes(anos, "MONTANT_X10") == [(3, "Bonus")] and not _codes(anos, "MONTANT_DIV10")


def test_stage_sans_montant_sans_avertissement():
    rows = [ligne(MATRICULE="S1", **{"Type Contrat": "Stage"}), ligne(MATRICULE="E2")]
    L, ens, _, _ = run(rows, postes={"p"})
    assert ens == {(3, "Primes sur ventes", "LIGNE_SANS_MONTANT")}
    assert L[0].type_contrat == "Stage" and not L[0].bloquant
