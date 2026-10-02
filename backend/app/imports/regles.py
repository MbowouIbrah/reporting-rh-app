"""Règles de validation d'import (port de tools/valider_import.py, en Decimal exact).

Fonction pure : aucune lecture en base, aucun float dans les montants.
"""

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from app.imports.lecture import Feuille, norm

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
    periodes_closes: set[tuple[int, int]] = field(default_factory=set)
    noms_connus: dict[str, str] = field(default_factory=dict)  # matricule casefold -> nom norm


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


def valider(feuille: Feuille, refs: Refs) -> tuple[list[Ligne], list[Anomalie], dict]:
    anos: list[Anomalie] = []
    nb_bloq = 0

    def add(num, col, code, grav, val, msg):
        nonlocal nb_bloq
        nb_bloq += grav == BLOQUANT
        anos.append(Anomalie(num, col, code, grav, None if val is None else str(val)[:500], msg))

    # ---- en-têtes
    rub_canon = {norm(r): r for r, _ in refs.rubriques} | refs.rubrique_alias
    attr_canon = {norm(a): a for a in ATTRIBUTS}
    cols: dict[str, int] = {}
    for j, v in enumerate(feuille.entetes):
        if v is None or str(v).strip() == "":
            continue
        n = norm(v)
        canon = attr_canon.get(n) or rub_canon.get(n)
        if canon is None:
            add(feuille.entete_ligne, str(v), "ENTETE_INCONNU", AVERT, v,
                "Colonne inconnue, ignorée à l'import.")
            continue
        if canon not in cols:
            cols[canon] = j
            if canon in rub_canon.values() and norm(canon) != n:
                add(feuille.entete_ligne, str(v), "ENTETE_ALIAS", AVERT, v,
                    f"Renommée « {canon} ».")
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
        def g(nom, row=row):
            j = cols[nom]
            return row[j] if j < len(row) else None

        L = Ligne(num)
        nb_avant = nb_bloq

        a = g("ANNÉE")
        r = nombre(a) if a is not None else None
        if r is None or r[0] != int(r[0]) or not ANNEE_MIN <= r[0] <= ANNEE_MAX:
            add(num, "ANNÉE", "ANNEE_INVALIDE", BLOQUANT, a,
                f"Entier entre {ANNEE_MIN} et {ANNEE_MAX} attendu.")
        else:
            L.annee = int(r[0])
            if r[1]:
                add(num, "ANNÉE", "TEXTE_CONVERTI", AVERT, a, "Année saisie en texte, convertie.")

        for nom, index, attr in (("MOIS", None, "mois"), ("Type Contrat", refs.contrats, "type_contrat"),
                                 ("Activité", refs.activites, "activite"), ("Site", refs.sites, "site"),
                                 ("Service", refs.services, "service")):
            v = g(nom)
            t = texte(v)
            if not t:
                add(num, nom, "VALEUR_MANQUANTE", BLOQUANT, v, "Obligatoire.")
                continue
            ref = {norm(m): m for m in MOIS} if index is None else index
            canon = ref.get(norm(t))
            if canon is None:
                add(num, nom, "REFERENTIEL_INCONNU", BLOQUANT, t, "Valeur absente du référentiel.")
                continue
            if canon != str(v):
                add(num, nom, "NORMALISE", AVERT, v, f"Normalisée en « {canon} ».")
            setattr(L, attr, MOIS.index(canon) + 1 if index is None else canon)

        mat_brut = g("MATRICULE")
        mat = texte(mat_brut)
        if not mat:
            add(num, "MATRICULE", "VALEUR_MANQUANTE", BLOQUANT, mat_brut, "Obligatoire.")
            mat = None
        else:
            if isinstance(mat_brut, (int, float)) and not isinstance(mat_brut, bool):
                add(num, "MATRICULE", "MATRICULE_NUMERIQUE", AVERT, mat_brut,
                    "Saisi en nombre : les zéros de tête ont pu être perdus.")
                mat = str(int(mat_brut)) if float(mat_brut).is_integer() else str(mat_brut)
            elif mat != str(mat_brut):
                add(num, "MATRICULE", "NORMALISE", AVERT, repr(mat_brut), "Espaces parasites supprimés.")
            if re.search(r"\s", mat):
                add(num, "MATRICULE", "MATRICULE_ESPACE", BLOQUANT, mat,
                    "Espace à l'intérieur du matricule.")
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
            add(num, "Poste", "POSTE_NOUVEAU", AVERT, L.poste, "Poste inconnu, créé à la validation.")

        if L.annee and L.mois and (L.annee, L.mois) in refs.periodes_closes:
            add(num, "MOIS", "PERIODE_CLOSE", BLOQUANT, f"{L.annee}-{L.mois:02d}",
                "Période close : import refusé.")

        if L.annee and L.mois and mat and not re.search(r"\s", mat):
            cles[(L.annee, L.mois, mat.casefold())].append(num)
            par_matricule[mat.casefold()].append((num, norm(L.nom or ""), {
                "Service": L.service, "Site": L.site, "Type Contrat": L.type_contrat,
                "Activité": L.activite}))

        for nom, unite in refs.rubriques:
            v = g(nom)
            if v is None or (isinstance(v, str) and not v.strip()):
                continue  # cellule vide : pas de montant
            if isinstance(v, str) and v.strip().startswith("#"):
                add(num, nom, "ERREUR_EXCEL", BLOQUANT, v, "Valeur d'erreur Excel (#N/A, #REF!...).")
                continue
            res = nombre(v)
            if res is None:
                add(num, nom, "NON_NUMERIQUE", BLOQUANT, v,
                    "Nombre attendu (pas de texte, d'unité ni de formule).")
                continue
            val, converti = res
            if converti:
                add(num, nom, "TEXTE_CONVERTI", AVERT, v, f"Nombre saisi en texte, converti en {val}.")
            if abs(val) >= BORNE:
                add(num, nom, "MONTANT_HORS_BORNES", BLOQUANT, v, "Valeur hors limites (15 chiffres).")
                continue
            q = val.quantize(TROIS, rounding=ROUND_HALF_UP)
            if q != val:
                add(num, nom, "PRECISION_TRONQUEE", AVERT, v, "Plus de 3 décimales, arrondi.")
            if unite == "jours":
                if q < 0 or q > ABSENCES_MAX:
                    add(num, nom, "ABSENCES_HORS_BORNES", BLOQUANT, v, f"Entre 0 et {ABSENCES_MAX} jours.")
            elif q < 0:
                add(num, nom, "MONTANT_NEGATIF", AVERT, v, "Montant négatif (régularisation ?).")
            L.montants[nom] = q

        L.bloquant = nb_bloq > nb_avant
        lignes.append(L)

    by_num = {L.num: L for L in lignes}
    for (a, m, mat), nums in cles.items():
        if len(nums) > 1:
            for k in nums:
                by_num[k].bloquant = True
                add(k, "ANNÉE+MOIS+MATRICULE", "DOUBLON", BLOQUANT, f"{a}-{m:02d} {mat}",
                    f"Clé en double (lignes {', '.join(map(str, nums))}).")

    for mat, occ in par_matricule.items():
        noms = {o[1] for o in occ if o[1]}
        connu = refs.noms_connus.get(mat)
        if connu:
            noms.add(connu)
        if len(noms) > 1:
            add(occ[0][0], "Noms", "NOM_INCOHERENT", AVERT, mat,
                "Plusieurs noms différents pour ce matricule.")
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
