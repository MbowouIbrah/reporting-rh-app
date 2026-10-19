"""Règles de validation d'import (port de tools/valider_import.py, en Decimal exact).

Fonction pure : aucune lecture en base, aucun float dans les montants.
"""

import hashlib
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
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
BORNE = Decimal(10) ** 15  # NUMERIC(18,3) : 15 chiffres entiers
RE_NOMBRE = re.compile(r"^-?\d{1,3}(?: ?\d{3})*(?:[.,]\d+)?$|^-?\d+(?:[.,]\d+)?$")
TROIS = Decimal("0.001")
# Textes qui signifient « pas de montant » (tiret, barre, néant…) : lus comme une cellule vide.
SANS_MONTANT = {"-", "--", "–", "—", "/", ".", "x", "n/a", "na", "neant", "nil", "rien", "aucun", "sans"}


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


def _qui(matricule: str) -> str:
    return "sans matricule" if est_sans_matricule(matricule) else f"matricule {matricule}"


def texte(v):
    return None if v is None else str(v).replace(" ", " ").strip()


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

    lignes: list[Ligne] = []
    cles: dict[tuple, list[int]] = defaultdict(list)
    par_matricule: dict[str, list[tuple[int, str, dict]]] = defaultdict(list)
    postes_vus: set[str] = set()

    for num, row in feuille.lignes:
        if ligne_vide(row, utiles):
            continue  # seules des colonnes non lues (calculées, inconnues) sont remplies

        L = Ligne(num)
        nb_avant = nb_bloq

        # Erreur Excel ou formule jamais calculée : cellule lue comme vide, signalée.
        row = list(row)
        for nom, j in cols.items():
            v = row[j] if j < len(row) else None
            if erreur_excel(v):
                add(num, nom, "ERREUR_EXCEL", AVERT, v, f"Erreur Excel {v.strip()} : cellule lue comme vide.")
                row[j] = None
            elif formule(v):
                add(num, nom, "FORMULE_SANS_VALEUR", AVERT, v,
                    "Formule sans valeur calculée, cellule lue comme vide : ouvrir le fichier dans Excel puis "
                    "l'enregistrer, ou copier les cellules puis Collage spécial › Valeurs.")
                row[j] = None

        def g(nom, row=row):
            j = cols[nom]
            return row[j] if j < len(row) else None

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
                add(num, nom, "VALEUR_MANQUANTE", BLOQUANT, v, f"Obligatoire. {admis(nom, index)}")
                continue
            ref = {norm(m): m for m in MOIS} if index is None else index
            canon = ref.get(norm(t))
            if canon is None:
                add(num, nom, "REFERENTIEL_INCONNU", BLOQUANT, t, f"Valeur inconnue. {admis(nom, index)}")
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

        for nom, attr, libelle in (("Noms", "nom", "Nom vide."), ("Poste", "poste", "Poste vide.")):
            t = texte(g(nom))
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
            res = nombre(v)
            if res is None:
                add(num, nom, "NON_NUMERIQUE", BLOQUANT, v,
                    "Nombre attendu, sans texte ni unité (ex. 25000).")
                continue
            val, converti = res
            if converti:
                add(num, nom, "TEXTE_CONVERTI", AVERT, v, f"Nombre saisi en texte, lu {val}.")
            if abs(val) >= BORNE:
                add(num, nom, "MONTANT_HORS_BORNES", BLOQUANT, v, "Nombre trop grand : 15 chiffres au plus avant la virgule.")
                continue
            q = val.quantize(TROIS, rounding=ROUND_HALF_UP)
            if q != val:
                add(num, nom, "PRECISION_TRONQUEE", AVERT, v, f"Plus de 3 décimales, arrondi à {q.normalize():f}.")
            if unite == "jours":
                if q < 0 or q > ABSENCES_MAX:
                    add(num, nom, "ABSENCES_HORS_BORNES", BLOQUANT, v, f"Nombre de jours attendu, de 0 à {ABSENCES_MAX}.")
            elif q < 0:
                add(num, nom, "MONTANT_NEGATIF", AVERT, v, "Montant négatif : régularisation ou erreur de signe ?")
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
                    f"Noms très proches ({_qui(occ[0][4])}) : {liste}. Faute de frappe ?")
            else:
                add(occ[0][0], "Noms", "NOM_INCOHERENT", AVERT, occ[0][4],
                    f"Noms différents ({_qui(occ[0][4])}) : {liste}.")
        elif not connu and noms:
            nom_norm = next(iter(noms))
            trouve = plus_proche(next(o[3] for o in occ if o[1] == nom_norm), refs.annuaire, mat,
                                 SEUIL_NOUVEAU_PROCHE)
            if trouve:
                add(occ[0][0], "Noms", "NOM_SIMILAIRE", AVERT, occ[0][4],
                    f"Nouvel employé « {occ[0][3]} » ({_qui(occ[0][4])}), très proche de « {trouve[1]} » "
                    f"({_qui(trouve[0])}). Matricule ou nom mal saisi ?")
        for champ in ("Service", "Site", "Type Contrat", "Activité"):
            vals = {o[2].get(champ) for o in occ if o[2].get(champ)}
            if len(vals) > 1:
                add(occ[0][0], champ, "MUTATION", AVERT, mat,
                    f"{champ} change selon les mois : {', '.join(sorted(vals))} (mutation ou erreur ?).")

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
