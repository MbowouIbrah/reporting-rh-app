"""Contrôle d'un fichier rempli avec le template d'import (feuille DONNEES).

Usage : python outils/valider_import.py FICHIER.xlsx [--sortie RAPPORT.xlsx]
Sortie : résumé console + rapport xlsx (une ligne par anomalie : ligne, colonne, code, gravité).
Code retour : 0 = importable, 1 = anomalie bloquante, 2 = fichier illisible.
Le fichier source n'est jamais modifié.
"""
import argparse
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

from openpyxl import Workbook, load_workbook

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
# mêmes normalisation et colonnes calculées que l'import du backend (dépend d'openpyxl seulement)
from app.imports.lecture import LIGNES_ENTETE, calculee, norm  # noqa: E402
from generer_template_import import (  # noqa: E402
    ACTIVITES, ATTRIBUTS, CONTRATS, MOIS, RUBRIQUES, SERVICES, SITES,
)

BLOQUANT, AVERT = "bloquant", "avertissement"
ENTETES = [a[0] for a in ATTRIBUTS] + [r[0] for r in RUBRIQUES]
ALIAS_ENTETES = {"Variable": "Commission"}  # V4 -> V5
ANNEE_MIN, ANNEE_MAX = 2000, 2100
ABSENCES_MAX = 31


def index_ref(valeurs):
    return {norm(v): v for v in valeurs}


REFS = {
    "MOIS": index_ref(MOIS), "Type Contrat": index_ref(CONTRATS),
    "Activité": index_ref(ACTIVITES), "Site": index_ref(SITES), "Service": index_ref(SERVICES),
}

RE_NOMBRE = re.compile(r"^-?\d{1,3}(?: ?\d{3})*(?:[.,]\d+)?$|^-?\d+(?:[.,]\d+)?$")


class Rapport:
    def __init__(self):
        self.lignes = []

    def add(self, ligne, colonne, code, gravite, valeur, message):
        self.lignes.append((ligne, colonne, code, gravite, "" if valeur is None else str(valeur), message))

    def compte(self, gravite):
        return sum(1 for a in self.lignes if a[3] == gravite)


def lire_entetes(brut, ligne, rap):
    """Colonnes reconnues -> position. En-têtes comparés comme au backend (accents, casse, NBSP)."""
    canon = {norm(e): e for e in ENTETES} | {norm(k): v for k, v in ALIAS_ENTETES.items()}
    cols = {}
    for j, v in enumerate(brut):
        if v is None or str(v).strip() == "":
            continue
        n = norm(v)
        e = canon.get(n)
        if e is None:
            # colonnes calculées de l'Excel REPORTING RH : ignorées sans avertissement
            if not calculee(n):
                rap.add(ligne, v, "ENTETE_INCONNU", AVERT, v, "Colonne inconnue, ignorée à l'import.")
            continue
        if n in {norm(k) for k in ALIAS_ENTETES}:
            rap.add(ligne, v, "ENTETE_ALIAS", AVERT, v, f"Renommée « {e} ».")
        cols.setdefault(e, j)
    manquants = [e for e in ENTETES if e not in cols]
    for m in manquants:
        rap.add(ligne, m, "ENTETE_MANQUANT", BLOQUANT, None, f"Colonne « {m} » absente.")
    return None if manquants else cols


def nombre(v):
    """Retourne (valeur, converti) ou None si non numérique."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v), False
    s = str(v).replace(" ", " ").strip()
    if RE_NOMBRE.match(s):
        s2 = s.replace(" ", "")
        if "," in s2 and "." in s2:
            return None  # séparateurs ambigus
        return float(s2.replace(",", ".")), True
    return None


def texte(v):
    return None if v is None else str(v).replace(" ", " ").strip()


def valider(chemin):
    rap, stats = Rapport(), {}
    wb = load_workbook(chemin, data_only=True, read_only=True)
    if "DONNEES" not in wb.sheetnames:
        raise ValueError("Feuille DONNEES introuvable.")
    lignes = wb["DONNEES"].iter_rows(values_only=True)
    # en-tête cherché dans les 10 premières lignes (ligne 3 dans l'Excel REPORTING RH et le template)
    entete, ligne_entete = None, 0
    for ligne_entete, row in enumerate(lignes, start=1):
        if ligne_entete > LIGNES_ENTETE:
            break
        if {"annee", "mois", "matricule"} <= {norm(v) for v in row if v is not None}:
            entete = row
            break
    if entete is None:
        raise ValueError("En-tête introuvable (ANNÉE, MOIS, MATRICULE) dans les 10 premières lignes.")

    cols = lire_entetes(entete, ligne_entete, rap)
    if cols is None:
        return rap, {"lignes": 0}

    cles = defaultdict(list)
    par_matricule = defaultdict(list)
    n = 0
    for num, row in enumerate(lignes, start=ligne_entete + 1):
        if all(j >= len(row) or row[j] is None or str(row[j]).strip() == "" for j in cols.values()):
            continue  # vide, ou seules les colonnes calculées (formules prolongées)
        n += 1
        g = lambda nom: row[cols[nom]] if cols[nom] < len(row) else None  # noqa: E731

        # --- ANNÉE
        annee = None
        a = g("ANNÉE")
        r = nombre(a) if a is not None else None
        if r is None or r[0] != int(r[0]) or not ANNEE_MIN <= r[0] <= ANNEE_MAX:
            rap.add(num, "ANNÉE", "ANNEE_INVALIDE", BLOQUANT, a, f"Entier entre {ANNEE_MIN} et {ANNEE_MAX} attendu.")
        else:
            annee = int(r[0])
            if r[1]:
                rap.add(num, "ANNÉE", "TEXTE_CONVERTI", AVERT, a, "Année saisie en texte, convertie.")

        # --- référentiels (MOIS + 4 listes)
        valeurs = {}
        for nom in ("MOIS", "Type Contrat", "Activité", "Site", "Service"):
            v = g(nom)
            t = texte(v)
            if not t:
                rap.add(num, nom, "VALEUR_MANQUANTE", BLOQUANT, v, "Obligatoire.")
                continue
            canon = REFS[nom].get(norm(t))
            if canon is None:
                rap.add(num, nom, "REFERENTIEL_INCONNU", BLOQUANT, t, "Valeur absente du référentiel.")
            else:
                valeurs[nom] = canon
                if canon != str(v):
                    rap.add(num, nom, "NORMALISE", AVERT, v, f"Normalisée en « {canon} ».")

        # --- matricule / noms / poste
        mat_brut = g("MATRICULE")
        mat = texte(mat_brut)
        if not mat:
            rap.add(num, "MATRICULE", "VALEUR_MANQUANTE", BLOQUANT, mat_brut, "Obligatoire.")
        else:
            if isinstance(mat_brut, (int, float)):
                rap.add(num, "MATRICULE", "MATRICULE_NUMERIQUE", AVERT, mat_brut,
                        "Saisi en nombre : les zéros de tête ont pu être perdus.")
                mat = str(int(mat_brut)) if float(mat_brut).is_integer() else str(mat_brut)
            elif mat != str(mat_brut):
                rap.add(num, "MATRICULE", "NORMALISE", AVERT, repr(mat_brut), "Espaces parasites supprimés.")
            if re.search(r"\s", mat):
                rap.add(num, "MATRICULE", "MATRICULE_ESPACE", BLOQUANT, mat, "Espace à l'intérieur du matricule.")
        nom_s = texte(g("Noms"))
        if not nom_s:
            rap.add(num, "Noms", "VALEUR_MANQUANTE", AVERT, None, "Nom vide.")
        poste = texte(g("Poste"))
        if not poste:
            rap.add(num, "Poste", "VALEUR_MANQUANTE", AVERT, None, "Poste vide.")

        # --- clé unique
        if annee and valeurs.get("MOIS") and mat:
            cles[(annee, MOIS.index(valeurs["MOIS"]) + 1, mat.casefold())].append(num)
            par_matricule[mat.casefold()].append((num, norm(nom_s or ""), valeurs))

        # --- montants
        for nom, unite in RUBRIQUES:
            v = g(nom)
            if v is None or (isinstance(v, str) and not v.strip()):
                continue  # vide = 0
            if isinstance(v, str) and v.strip().startswith("#"):
                rap.add(num, nom, "ERREUR_EXCEL", BLOQUANT, v, "Valeur d'erreur Excel (#N/A, #REF!...).")
                continue
            res = nombre(v)
            if res is None:
                rap.add(num, nom, "NON_NUMERIQUE", BLOQUANT, v, "Nombre attendu (pas de texte, d'unité ni de formule).")
                continue
            val, converti = res
            if converti:
                rap.add(num, nom, "TEXTE_CONVERTI", AVERT, v, f"Nombre saisi en texte, converti en {val:g}.")
            if nom == "Absences (nb)":
                if val < 0 or val > ABSENCES_MAX:
                    rap.add(num, nom, "ABSENCES_HORS_BORNES", BLOQUANT, v, f"Entre 0 et {ABSENCES_MAX} jours.")
            elif val < 0:
                rap.add(num, nom, "MONTANT_NEGATIF", AVERT, v, "Montant négatif (régularisation ?).")

    for (a, m, mat), nums in cles.items():
        if len(nums) > 1:
            for k in nums:
                rap.add(k, "ANNÉE+MOIS+MATRICULE", "DOUBLON", BLOQUANT, f"{a}-{m:02d} {mat}",
                        f"Clé en double (lignes {', '.join(map(str, nums))}).")

    # cohérence d'un matricule entre les mois
    for mat, occ in par_matricule.items():
        noms = {o[1] for o in occ if o[1]}
        if len(noms) > 1:
            for num, _, _ in occ[:1]:
                rap.add(num, "Noms", "NOM_INCOHERENT", AVERT, mat, "Plusieurs noms différents pour ce matricule.")
        for champ in ("Service", "Site", "Type Contrat", "Activité"):
            vals = {o[2].get(champ) for o in occ if o[2].get(champ)}
            if len(vals) > 1:
                rap.add(occ[0][0], champ, "MUTATION", AVERT, mat,
                        f"{champ} change selon les mois : {', '.join(sorted(vals))} (mutation ou erreur ?).")

    if n == 0:
        rap.add(2, "DONNEES", "FICHIER_VIDE", BLOQUANT, None, "Aucune ligne de données.")
    periodes = Counter()
    for (a, m, _), _n in cles.items():
        periodes[(a, m)] += 1
    stats.update(lignes=n, periodes=len(periodes), salaries=len(par_matricule),
                 plage=(f"{min(periodes)[0]}-{min(periodes)[1]:02d} → {max(periodes)[0]}-{max(periodes)[1]:02d}"
                        if periodes else "—"))
    return rap, stats


def ecrire_rapport(rap, stats, chemin):
    wb = Workbook()
    ws = wb.active
    ws.title = "ANOMALIES"
    ws.append(["Ligne", "Colonne", "Code", "Gravité", "Valeur", "Message"])
    for a in sorted(rap.lignes, key=lambda x: (x[3] != BLOQUANT, x[0], str(x[1]))):
        ws.append(list(a))
    for col, w in zip("ABCDEF", (8, 24, 24, 14, 26, 70)):
        ws.column_dimensions[col].width = w
    ws.freeze_panes = "A2"
    ws2 = wb.create_sheet("SYNTHESE")
    for k, v in stats.items():
        ws2.append([k, str(v)])
    ws2.append(["bloquantes", rap.compte(BLOQUANT)])
    ws2.append(["avertissements", rap.compte(AVERT)])
    for code, c in Counter(a[2] for a in rap.lignes).most_common():
        ws2.append([f"  {code}", c])
    ws2.column_dimensions["A"].width = 34
    wb.save(chemin)


def main(argv=None):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("fichier")
    p.add_argument("--sortie")
    args = p.parse_args(argv)
    src = Path(args.fichier)
    try:
        rap, stats = valider(src)
    except Exception as e:  # fichier illisible
        print(f"ERREUR : {e}")
        return 2
    sortie = Path(args.sortie) if args.sortie else src.with_name(src.stem + "_rapport.xlsx")
    ecrire_rapport(rap, stats, sortie)
    b, w = rap.compte(BLOQUANT), rap.compte(AVERT)
    print(f"{stats.get('lignes', 0)} lignes · {stats.get('salaries', 0)} salariés · {stats.get('periodes', 0)} périodes ({stats.get('plage', '—')})")
    print(f"{b} bloquante(s) · {w} avertissement(s) → {sortie}")
    for code, c in Counter(a[2] for a in rap.lignes if a[3] == BLOQUANT).most_common(8):
        print(f"  [bloquant] {code}: {c}")
    print("IMPORTABLE" if b == 0 else "NON IMPORTABLE : corriger les anomalies bloquantes")
    return 0 if b == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
