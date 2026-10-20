"""Règles de validation d'import (port de tools/valider_import.py, en Decimal exact).

Fonction pure : aucune lecture en base, aucun float dans les montants.
"""

import hashlib
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from itertools import combinations

from openpyxl.utils import get_column_letter

from app.imports.lecture import (
    MAX_LIGNES_VIDES,
    Feuille,
    calculee,
    erreur_excel,
    formule,
    ligne_vide,
    norm,
)
from app.imports.similarite import SEUIL_NOM_PROCHE, SEUIL_NOUVEAU_PROCHE, plus_proche, similarite

BLOQUANT, AVERT = "bloquant", "avertissement"
MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet",
        "Août", "Septembre", "Octobre", "Novembre", "Décembre"]
ATTRIBUTS = ["ANNÉE", "MOIS", "MATRICULE", "Noms", "Poste", "Type Contrat", "Activité", "Site",
             "Service"]
ANNEE_MIN, ANNEE_MAX = 2000, 2100
ABSENCES_MAX = 31
BORNE = Decimal(10) ** 15  # 15 chiffres avant la virgule ; décimales gardées telles quelles
RE_NOMBRE = re.compile(r"^-?\d{1,3}(?: ?\d{3})*(?:[.,]\d+)?$|^-?\d+(?:[.,]\d+)?$")
# Référence à un autre classeur : ='[1]Feuil1'!A1, ='C:\dossier\[source.xlsx]Feuil1'!A1.
RE_LIAISON = re.compile(r"\[[^\]]+\][^!\[]*!")
# Formule ou erreur sans valeur utilisable : fichier refusé avant toute correction.
CODES_FORMULE = ("FORMULE_SANS_VALEUR", "ERREUR_EXCEL", "LIAISON_ERREUR")
# Textes qui signifient « pas de montant » (tiret, barre, néant…) : lus comme une cellule vide.
SANS_MONTANT = {"-", "--", "–", "—", "/", ".", "x", "n/a", "na", "neant", "nil", "rien", "aucun", "sans"}
# Ligne de total : « TOTAL », « Sous-total »… dans une colonne d'attribut, ou somme Excel sans matricule.
RE_TOTAL = re.compile(r"(sous[\s-]?)?tota(l|ux)\b")
RE_SOMME = re.compile(r"\b(SUM|SOMME|SUBTOTAL|SOUS\.TOTAL)\s*\(", re.I)


@dataclass
class Refs:
    """Référentiels lus en base : libellé canonique indexé par texte normalisé."""

    services: dict[str, str]
    activites: dict[str, str]
    sites: dict[str, str]
    contrats: dict[str, str]
    rubriques: list[tuple[str, str]]  # (libellé, unité) dans l'ordre
    rubrique_alias: dict[str, str] = field(default_factory=dict)  # norm -> libellé canonique
    postes: set[str] = field(default_factory=set)  # normalisés
    noms_connus: dict[str, str] = field(default_factory=dict)  # matricule casefold -> nom norm
    annuaire: dict[str, tuple[str, str]] = field(default_factory=dict)  # matricule casefold -> (matricule, nom)
    # matricule casefold -> mois enregistrés (année, mois, {colonne: libellé}), du plus ancien au plus récent
    historique: dict[str, list[tuple[int, int, dict[str, str]]]] = field(default_factory=dict)


@dataclass
class Anomalie:
    ligne: int | None
    colonne: str | None
    code: str
    gravite: str
    valeur: str | None
    message: str


@dataclass
class Ligne:
    num: int
    annee: int | None = None
    mois: int | None = None
    matricule: str | None = None
    nom: str | None = None
    poste: str | None = None
    service: str | None = None
    site: str | None = None
    activite: str | None = None
    type_contrat: str | None = None
    montants: dict[str, Decimal] = field(default_factory=dict)
    bloquant: bool = False


PREFIXE_SANS_MATRICULE = "SM-"


def est_sans_matricule(matricule: str | None) -> bool:
    return bool(matricule) and matricule.startswith(PREFIXE_SANS_MATRICULE)


def matricule_sans_matricule(nom: str, refs: "Refs") -> tuple[str, list[str]]:
    """Identifiant d'un employé sans matricule, déduit de son nom : (matricule, homonymes en cas d'ambiguïté).

    Un employé déjà connu sous ce nom (nom nettoyé : espaces, casse, accents) est retrouvé ; sinon un
    identifiant technique stable est dérivé du nom, pour que les mois suivants retombent sur la même fiche."""
    cle = norm(nom)
    connus = [m for m, n in refs.noms_connus.items() if n == cle]
    if len(connus) == 1:
        return refs.annuaire.get(connus[0], (connus[0], ""))[0], []
    if len(connus) > 1:
        return "", sorted(refs.annuaire.get(m, (m, ""))[0] for m in connus)
    return PREFIXE_SANS_MATRICULE + hashlib.sha1(cle.encode()).hexdigest()[:12].upper(), []


LIBELLES = {"MOIS": "Mois", "Type Contrat": "Types de contrat", "Activité": "Activités", "Site": "Sites",
            "Service": "Services"}
MAX_ADMIS = 15


def admis(colonne: str, index: dict[str, str] | None) -> str:
    """Valeurs acceptées pour une colonne à liste, pour les citer dans le message d'erreur."""
    if index is None:
        return "Mois en lettres, de Janvier à Décembre."
    vals = sorted(set(index.values()), key=norm)
    suite = ", …" if len(vals) > MAX_ADMIS else ""
    return f"{LIBELLES[colonne]} admis : {', '.join(vals[:MAX_ADMIS])}{suite}."


SUJETS = {"MOIS": "Le mois", "Type Contrat": "Le type de contrat", "Activité": "L’activité", "Site": "Le site",
          "Service": "Le service"}


def _periode(L) -> str:
    return f"{MOIS[L.mois - 1].lower()} {L.annee}" if L.annee and L.mois else f"ligne {L.num}"


def _porteur(matricule: str) -> str:
    return "L’employé sans matricule" if est_sans_matricule(matricule) else f"Le matricule {matricule}"


def _qui(matricule: str) -> str:
    return "sans matricule" if est_sans_matricule(matricule) else f"matricule {matricule}"


def texte(v):
    return None if v is None else str(v).replace(" ", " ").strip()


def ligne_de_total(row, cols, formules) -> tuple[str, str] | None:
    """(colonne, valeur) qui montre qu'une ligne est un total et non un employé, sinon None."""
    def g(nom):
        return row[cols[nom]] if cols[nom] < len(row) else None
    mat = texte(g("MATRICULE"))
    for nom in ATTRIBUTS:
        t = texte(g(nom))
        if t and RE_TOTAL.match(norm(t)) and (not mat or nom == "MATRICULE"):
            return nom, t
    if not mat:
        par_j = {j: nom for nom, j in cols.items()}
        for j, f in sorted(formules.items()):
            if j in par_j and RE_SOMME.search(f):
                return par_j[j], f
    return None


def nombre(v) -> tuple[Decimal, bool] | None:
    """(valeur, converti_depuis_texte) ou None si non numérique / non fini."""
    if isinstance(v, bool):
        return None
    try:
        if isinstance(v, int):
            return Decimal(v), False
        if isinstance(v, float):
            d = Decimal(repr(v))
            return (d, False) if d.is_finite() else None
        if isinstance(v, Decimal):
            return (v, False) if v.is_finite() else None
        s = str(v).replace(" ", " ").strip()
        if not RE_NOMBRE.match(s):
            return None
        s2 = s.replace(" ", "")
        if "," in s2 and "." in s2:
            return None  # séparateurs ambigus
        return Decimal(s2.replace(",", ".")), True
    except InvalidOperation:
        return None


def fr(d: Decimal) -> str:
    """Nombre tel qu'affiché à l'écran : espace pour les milliers, virgule pour les décimales."""
    s = f"{d:f}"
    signe, s = ("-", s[1:]) if s.startswith("-") else ("", s)
    e, _, dec = s.partition(".")
    return f"{signe}{int(e):,}".replace(",", " ") + (f",{dec}" if dec else "")


# Nombre suivi d'une devise ou d'une unité : « 25 000 FCFA », « 25000 F », « 3 jours ».
RE_UNITE = re.compile(r"(-?[\d\s.,]*\d)\s*(f\s?cfa|cfa|xaf|frs?|francs?|f|jours?|jrs?|j)?\.?", re.I)
# Milliers séparés par un point ou une virgule, décimales éventuelles avec l'autre signe.
RE_MILLIERS = re.compile(r"(-?\d{1,3}([.,])\d{3}(?:\2\d{3})*)(?:([.,])(\d+))?")
# Un seul séparateur suivi de trois chiffres : milliers ou décimales.
RE_AMBIGU = re.compile(r"-?[1-9]\d{0,2}([.,])\d{3}")
SIGNE = {".": "point", ",": "virgule"}


def interpretations(v) -> list[tuple[Decimal, str]]:
    """Lectures possibles d'un nombre saisi en texte, avec le libellé de la correction :
    une si l'intention est évidente, deux si le séparateur est ambigu (« 45.000 »), aucune sinon."""
    if not isinstance(v, str):
        return []
    m = RE_UNITE.fullmatch(texte(v) or "")
    if not m:
        return []
    s = re.sub(r"\s", "", m[1])
    if RE_AMBIGU.fullmatch(s):
        sep = SIGNE[s[-4]]
        milliers, decimale = Decimal(s[:-4] + s[-3:]), Decimal(f"{s[:-4]}.{s[-3:]}")
        return [(milliers, f"{fr(milliers)} (le {sep} sépare les milliers)"),
                (decimale, f"{fr(decimale.normalize())} (le {sep} sépare les décimales)")]
    if re.fullmatch(r"-?\d+(?:[.,]\d+)?", s):
        d = Decimal(s.replace(",", "."))
    else:
        mm = RE_MILLIERS.fullmatch(s)
        if not mm or mm[3] == mm[2] or (not mm[3] and mm[1].count(mm[2]) == 1):
            return []
        entier = re.sub(r"[.,]", "", mm[1])
        d = Decimal(f"{entier}.{mm[4]}" if mm[3] else entier)
    return [(d, f"Corriger en {fr(d)}")]


def entetes_reconnus(refs: Refs) -> set[str]:
    """En-têtes normalisés lus par les règles : seuls eux décident si une ligne est vide."""
    return {norm(a) for a in ATTRIBUTS} | {norm(r) for r, _ in refs.rubriques} | set(refs.rubrique_alias)


def colonnes(entetes: list, refs: Refs) -> dict[str, int]:
    """Position de chaque colonne reconnue, par nom de référence (la première en cas de doublon)."""
    rub_canon = {norm(r): r for r, _ in refs.rubriques} | refs.rubrique_alias
    attr_canon = {norm(a): a for a in ATTRIBUTS}
    cols: dict[str, int] = {}
    for j, v in enumerate(entetes):
        if v is not None and str(v).strip() != "":
            canon = attr_canon.get(norm(v)) or rub_canon.get(norm(v))
            if canon is not None:
                cols.setdefault(canon, j)
    return cols


def valider(feuille: Feuille, refs: Refs) -> tuple[list[Ligne], list[Anomalie], dict]:
    anos: list[Anomalie] = []
    nb_bloq = 0

    def add(num, col, code, grav, val, msg):
        nonlocal nb_bloq
        nb_bloq += grav == BLOQUANT
        anos.append(Anomalie(num, None if col is None else str(col)[:100], code, grav, None if val is None else str(val)[:500], msg))

    # ---- en-têtes
    rub_canon = {norm(r): r for r, _ in refs.rubriques} | refs.rubrique_alias
    attr_canon = {norm(a): a for a in ATTRIBUTS}
    cols: dict[str, int] = {}
    utiles: list[int] = []  # colonnes reconnues, doublons compris (même règle que la lecture)
    for j, v in enumerate(feuille.entetes):
        if v is None or str(v).strip() == "":
            continue
        n = norm(v)
        canon = attr_canon.get(n) or rub_canon.get(n)
        if canon is None and calculee(n):
            continue
        if canon is None:
            add(feuille.entete_ligne, str(v), "ENTETE_INCONNU", AVERT, v,
                "Colonne inconnue, ignorée à l'import.")
            continue
        utiles.append(j)
        if canon in cols:
            add(feuille.entete_ligne, str(v), "ENTETE_DOUBLON", BLOQUANT, v,
                f"« {canon} » déjà en colonne {get_column_letter(cols[canon] + 1)} : "
                "garder une seule de ces colonnes.")
            continue
        cols[canon] = j
        if canon in rub_canon.values() and norm(canon) != n:
            add(feuille.entete_ligne, str(v), "ENTETE_ALIAS", AVERT, v, f"Renommée « {canon} ».")
    if feuille.ligne_ignoree:
        add(feuille.ligne_ignoree, None, "LIGNES_IGNOREES", BLOQUANT, None,
            f"Données après {MAX_LIGNES_VIDES} lignes vides consécutives : elles ne seraient pas "
            "importées. Supprimer les lignes vides au-dessus.")
    requis = ATTRIBUTS + [r for r, _ in refs.rubriques]
    manquants = [e for e in requis if e not in cols]
    for m in manquants:
        add(feuille.entete_ligne, m, "ENTETE_MANQUANT", BLOQUANT, None, f"Colonne « {m} » absente.")
    if manquants:
        return [], anos, {"lignes": 0}

    # ---- formules : seule la valeur enregistrée par Excel est lue, jamais la formule
    liaisons: list[tuple] = []
    for num, row in feuille.lignes:
        if ligne_vide(row, utiles):
            continue
        fs = feuille.formules.get(num, {})
        for nom, j in cols.items():
            v, f = (row[j] if j < len(row) else None), fs.get(j)
            lien = f is not None and RE_LIAISON.search(f) is not None
            if formule(v):
                add(num, nom, "FORMULE_SANS_VALEUR", BLOQUANT, v, "La formule n'a pas de valeur calculée : "
                    "le fichier n'a pas été enregistré par Excel après le calcul.")
            elif erreur_excel(v) and lien:
                add(num, nom, "LIAISON_ERREUR", BLOQUANT, f, f"La liaison vers un autre fichier donne l'erreur "
                    f"{v.strip()} : le fichier source était introuvable au dernier calcul.")
            elif erreur_excel(v):
                add(num, nom, "ERREUR_EXCEL", BLOQUANT, f or v, f"La formule donne l'erreur {v.strip()}." if f
                    else f"La cellule contient l'erreur Excel {v.strip()}, sans formule.")
            elif lien:
                liaisons.append((num, nom, f, v))
    if any(a.code in CODES_FORMULE for a in anos):
        return [], anos, {"lignes": 0}
    for num, nom, f, v in liaisons:
        lu = "vide" if v is None or str(v).strip() == "" else (f"{v:g}" if isinstance(v, float) else str(v))
        add(num, nom, "LIAISON_EXTERNE", AVERT, f, f"Valeur lue : {lu}, telle qu'Excel l'a calculée à la "
            "dernière ouverture. Vérifiez qu'elle est à jour.")

    lignes: list[Ligne] = []
    cles: dict[tuple, list[int]] = defaultdict(list)
    par_matricule: dict[str, list[tuple[int, str, dict]]] = defaultdict(list)
    postes_vus: set[str] = set()

    for num, row in feuille.lignes:
        if ligne_vide(row, utiles):
            continue  # seules des colonnes non lues (calculées, inconnues) sont remplies

        L = Ligne(num)
        nb_avant = nb_bloq

        def g(nom, row=row):
            j = cols[nom]
            return row[j] if j < len(row) else None

        total = ligne_de_total(row, cols, feuille.formules.get(num, {}))
        if total:
            # Un seul point pour la ligne : ses cellules vides ne sont pas des oublis.
            add(num, total[0], "LIGNE_TOTAL", BLOQUANT, total[1],
                "Ligne de total : elle ne concerne aucun employé et ne peut pas être importée.")
            L.bloquant = True
            lignes.append(L)
            continue

        a = g("ANNÉE")
        r = nombre(a) if a is not None else None
        if r is None or r[0] != int(r[0]) or not ANNEE_MIN <= r[0] <= ANNEE_MAX:
            add(num, "ANNÉE", "ANNEE_INVALIDE", BLOQUANT, a,
                f"Année attendue : nombre entier de {ANNEE_MIN} à {ANNEE_MAX} (ex. 2026).")
        else:
            L.annee = int(r[0])
            if r[1]:
                add(num, "ANNÉE", "TEXTE_CONVERTI", AVERT, a, f"Année saisie en texte, lue {int(r[0])}.")

        for nom, index, attr in (("MOIS", None, "mois"), ("Type Contrat", refs.contrats, "type_contrat"),
                                 ("Activité", refs.activites, "activite"), ("Site", refs.sites, "site"),
                                 ("Service", refs.services, "service")):
            v = g(nom)
            t = texte(v)
            if not t:
                add(num, nom, "VALEUR_MANQUANTE", BLOQUANT, v, f"{SUJETS[nom]} est obligatoire et la cellule est vide. {admis(nom, index)}")
                continue
            ref = {norm(m): m for m in MOIS} if index is None else index
            canon = ref.get(norm(t))
            if canon is None:
                add(num, nom, "REFERENTIEL_INCONNU", BLOQUANT, t, f"« {t} » ne figure pas dans la liste. {admis(nom, index)}")
                continue
            if canon != str(v):
                add(num, nom, "NORMALISE", AVERT, v, f"Écrit « {t} », repris comme « {canon} ».")
            setattr(L, attr, MOIS.index(canon) + 1 if index is None else canon)

        mat_brut = g("MATRICULE")
        mat = texte(mat_brut)
        if not mat:
            nom_seul = texte(g("Noms"))
            if not nom_seul:
                add(num, "MATRICULE", "VALEUR_MANQUANTE", BLOQUANT, mat_brut,
                    "Matricule ou nom obligatoire (un employé sans matricule est identifié par son nom).")
                mat = None
            else:
                mat, homonymes = matricule_sans_matricule(nom_seul, refs)
                if homonymes:
                    add(num, "MATRICULE", "NOM_HOMONYME", BLOQUANT, nom_seul,
                        f"Plusieurs employés portent ce nom ({', '.join(homonymes)}) : indiquer le matricule.")
                    mat = None
        else:
            if isinstance(mat_brut, (int, float)) and not isinstance(mat_brut, bool):
                add(num, "MATRICULE", "MATRICULE_NUMERIQUE", AVERT, mat_brut,
                    "Matricule saisi en nombre : les zéros ou lettres de tête ont pu être perdus.")
                mat = str(int(mat_brut)) if float(mat_brut).is_integer() else str(mat_brut)
            elif mat != str(mat_brut):
                add(num, "MATRICULE", "NORMALISE", AVERT, repr(mat_brut), "Espaces en trop supprimés.")
            if re.search(r"\s", mat):
                add(num, "MATRICULE", "MATRICULE_ESPACE", BLOQUANT, mat,
                    f"Matricule attendu sans espace (« {re.sub(r'\s', '', mat)} » ?).")
            if len(mat) > 30:
                add(num, "MATRICULE", "TEXTE_TROP_LONG", BLOQUANT, mat, "30 caractères maximum.")
        L.matricule = mat

        for nom, attr, libelle in (("Noms", "nom", "Le nom de l’employé est vide."),
                                      ("Poste", "poste", "Le poste est vide.")):
            t = texte(g(nom))
            t = t and re.sub(r"\s+", " ", t)  # espaces en double retirés sans signalement
            if not t:
                add(num, nom, "VALEUR_MANQUANTE", AVERT, None, libelle)
            elif len(t) > 200:
                add(num, nom, "TEXTE_TROP_LONG", BLOQUANT, t, "200 caractères maximum.")
            else:
                setattr(L, attr, t)
        if L.poste and norm(L.poste) not in refs.postes and norm(L.poste) not in postes_vus:
            postes_vus.add(norm(L.poste))
            add(num, "Poste", "POSTE_NOUVEAU", AVERT, L.poste, "Poste inconnu : il sera créé à l'enregistrement.")

        if L.annee and L.mois and mat and not re.search(r"\s", mat):
            cles[(L.annee, L.mois, mat.casefold())].append(num)
            par_matricule[mat.casefold()].append((num, norm(L.nom or ""), {
                "Service": L.service, "Site": L.site, "Type Contrat": L.type_contrat,
                "Activité": L.activite}, L.nom or "", mat))

        for nom, unite in refs.rubriques:
            v = g(nom)
            if v is None or (isinstance(v, str) and not v.strip()):
                continue  # cellule vide : pas de montant
            if isinstance(v, str) and norm(v) in SANS_MONTANT:
                add(num, nom, "SANS_MONTANT", AVERT, v,
                    f"« {v.strip()} » lu comme vide (aucun montant). Sinon, saisir le montant.")
                continue
            lectures = interpretations(v)
            if len(lectures) == 2:
                (a, _), (b, _) = lectures
                sep = "point" if "." in v else "virgule"
                add(num, nom, "SEPARATEUR_AMBIGU", BLOQUANT, v,
                    f"« {texte(v)} » : le {sep} peut séparer les milliers ({fr(a)}) ou les décimales "
                    f"({fr(b.normalize())}). Choisir la bonne lecture.")
                continue
            res = nombre(v)
            if res is None and lectures:
                # Intention évidente (« 25 000 FCFA », « 1.250.000 ») : seul le nombre est gardé.
                res = (lectures[0][0], False)
                unite = RE_UNITE.fullmatch(texte(v))[2]
                add(num, nom, "TEXTE_CONVERTI", AVERT, v, f"« {texte(v)} » lu {fr(res[0])} : " + (
                    f"un montant est un nombre seul, « {unite} » n'est pas gardé." if unite
                    else "les séparateurs de milliers ne sont pas gardés."))
            if res is None:
                add(num, nom, "NON_NUMERIQUE", BLOQUANT, v, "Nombre attendu, sans texte ni unité (ex. 25 000).")
                continue
            val, converti = res
            # Valeur montrée dans le point : le texte saisi tel quel, un nombre au format de l'écran.
            vu = v if isinstance(v, str) else fr(val)
            if converti:
                add(num, nom, "TEXTE_CONVERTI", AVERT, v, f"Nombre saisi en texte, lu {fr(val)}.")
            if abs(val) >= BORNE:
                add(num, nom, "MONTANT_HORS_BORNES", BLOQUANT, vu, "Nombre trop grand : 15 chiffres au plus avant la virgule.")
                continue
            # Montant gardé tel qu'il vient, sans arrondi ; au moins 3 décimales (zéros ajoutés).
            q = val if val.as_tuple().exponent <= -3 else val.quantize(Decimal("0.001"))
            if unite == "jours":
                if q < 0 or q > ABSENCES_MAX:
                    add(num, nom, "ABSENCES_HORS_BORNES", BLOQUANT, vu, f"Nombre de jours attendu, de 0 à {ABSENCES_MAX}.")
            elif q < 0:
                add(num, nom, "MONTANT_NEGATIF", AVERT, vu, "Montant négatif : régularisation ou erreur de signe ?")
            L.montants[nom] = q

        L.bloquant = nb_bloq > nb_avant
        lignes.append(L)

    by_num = {L.num: L for L in lignes}
    for (a, m, _mat), nums in cles.items():
        if len(nums) > 1:
            # Une seule erreur pour le groupe, ancrée sur la première ligne : les autres sont citées.
            for k in nums:
                by_num[k].bloquant = True
            liste = ", ".join(map(str, nums[:-1])) + f" et {nums[-1]}"
            add(nums[0], "MATRICULE", "DOUBLON", BLOQUANT, by_num[nums[0]].matricule,
                f"Même employé deux fois pour {MOIS[m - 1].lower()} {a} (lignes {liste}) : garder une seule ligne.")

    for mat, occ in par_matricule.items():
        noms = {o[1] for o in occ if o[1]}
        connu = refs.noms_connus.get(mat)
        if connu:
            noms.add(connu)
        if len(noms) > 1:
            affiches = {o[1]: o[3] for o in occ if o[1]}
            if connu:
                affiches.setdefault(connu, refs.annuaire.get(mat, ("", connu))[1])
            liste = " / ".join(f"« {affiches[n]} »" for n in sorted(affiches))
            proches = all(similarite(a, b) >= SEUIL_NOM_PROCHE for a, b in combinations(sorted(noms), 2))
            if proches:
                add(occ[0][0], "Noms", "NOM_PROCHE", AVERT, occ[0][4],
                    f"{_porteur(occ[0][4])} porte des noms très proches : {liste}. Faute de frappe ?")
            else:
                add(occ[0][0], "Noms", "NOM_INCOHERENT", AVERT, occ[0][4],
                    f"{_porteur(occ[0][4])} porte des noms différents : {liste}. Erreur de matricule ?")
        elif not connu and noms:
            nom_norm = next(iter(noms))
            trouve = plus_proche(next(o[3] for o in occ if o[1] == nom_norm), refs.annuaire, mat,
                                 SEUIL_NOUVEAU_PROCHE)
            if trouve:
                add(occ[0][0], "Noms", "NOM_SIMILAIRE", AVERT, occ[0][4],
                    f"Nouvel employé « {occ[0][3]} » ({_qui(occ[0][4])}) : nom très proche de « {trouve[1]} » "
                    f"({_qui(trouve[0])}). Même personne avec un matricule ou un nom mal saisi ?")
        qui = next((o[3] for o in occ if o[3]), None) or refs.annuaire.get(mat, ("", ""))[1] or _qui(mat)
        debut = min((by_num[o[0]].annee, by_num[o[0]].mois) for o in occ)
        # Dernier mois déjà enregistré avant le premier mois du fichier : point de départ des changements.
        avant = next((h for h in reversed(refs.historique.get(mat, [])) if (h[0], h[1]) < debut), None)
        for champ in ("Service", "Site", "Type Contrat", "Activité"):
            # Valeurs dans l'ordre des mois, puis du fichier : « passe de X (juillet) à Y (août) ».
            suite = sorted((o for o in occ if o[2].get(champ)),
                           key=lambda o: (by_num[o[0]].annee, by_num[o[0]].mois, o[0]))
            etapes: list[tuple[str, str, int | None]] = []
            if avant and avant[2].get(champ):
                etapes.append((avant[2][champ], f"{MOIS[avant[1] - 1].lower()} {avant[0]}, déjà enregistré", None))
            for o in suite:
                if not etapes or norm(etapes[-1][0]) != norm(o[2][champ]):
                    etapes.append((o[2][champ], _periode(by_num[o[0]]), o[0]))
            if len(etapes) < 2:
                continue
            if len({e[1] for e in etapes}) == 1:
                detail = ", ".join(f"« {v} » (ligne {n})" for v, _p, n in etapes)
                add(etapes[0][2], champ, "MUTATION", AVERT, etapes[0][0],
                    f"{SUJETS[champ]} de {qui} diffère d’une ligne à l’autre en {etapes[0][1]} : {detail}.")
                continue
            # Un point par changement, sur la ligne du nouveau mois : changement voulu ou erreur de saisie.
            for prec, (v, p, n) in zip(etapes, etapes[1:], strict=False):
                add(n, champ, "MUTATION", AVERT, v,
                    f"{SUJETS[champ]} de {qui} passe de « {prec[0]} » ({prec[1]}) à « {v} » ({p}) : "
                    "mutation ou erreur ?")

    if not lignes:
        add(feuille.entete_ligne + 1, "DONNEES", "FICHIER_VIDE", BLOQUANT, None, "Aucune ligne de données.")
    periodes = Counter((k[0], k[1]) for k in cles)
    stats = {
        "lignes": len(lignes),
        "periodes": len(periodes),
        "salaries": len(par_matricule),
        "plage": (f"{min(periodes)[0]}-{min(periodes)[1]:02d} → {max(periodes)[0]}-{max(periodes)[1]:02d}"
                  if periodes else "—"),
    }
    return lignes, anos, stats
