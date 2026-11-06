"""Historique de paie 100 % fictif pour la recette : mêmes données à chaque passage.

Trois années civiles (janvier 2024 → mois de fin choisi), mêmes colonnes que la feuille DONNEES
du modèle d'import. Noms, matricules et montants inventés ; tirage à graine fixe.

Usage : python tools/recette/donnees_fictives.py [--fin 2026-10] [sortie.xlsx]
La liste des cas couverts s'affiche à la fin.
"""

import argparse
import random
from pathlib import Path

ENTETES = [
    "ANNÉE",
    "MOIS",
    "MATRICULE",
    "Noms",
    "Poste",
    "Type Contrat",
    "Activité",
    "Site",
    "Service",
    "Salaire brut garantie",
    "Frais de mission",
    "Primes exceptionnelles",
    "Logement site déporté",
    "Carburant véhicule service",
    "Crédit téléphonique",
    "Brut Réel",
    "Variable",
    "Charges Patronales",
    "Assurance Maladie",
    "Formation",
    "Bonus",
    "TVA & Marge MAD",
    "Absences (nb)",
    "Primes sur ventes",
    "Primes sur résultats",
    "Productivité Ateliers",
    "TOTAL CHARGES (FCFA)",
]
MOIS = [
    "Janvier",
    "Février",
    "Mars",
    "Avril",
    "Mai",
    "Juin",
    "Juillet",
    "Août",
    "Septembre",
    "Octobre",
    "Novembre",
    "Décembre",
]
DEBUT = (2024, 1)
FRONT, BACK = "Front office", "Back Office"
AGENCES = ["Douala", "Yaoundé", "Bertoua", "Ngaoundéré", "Garoua"]
DEPORTES = ["Dehane", "Libongo", "Njombe", "Dimon", "Nkoteng"]
SITES = {
    "Commerce VN": AGENCES,
    "Commerce Pièces": AGENCES,
    "Pneumatique": AGENCES,
    "Administration": AGENCES[:2] + AGENCES[4:],
    "SAV PL": ["Douala", "Yaoundé", "Garoua", "Dehane", "Nkoteng"],
    "SAV Engins": ["Douala", "Garoua", "Dehane", "Libongo", "Nkoteng"],
    "Sites Déportés": DEPORTES,
}
POSTES = {  # service -> (postes front office, postes back office) ; postes déjà connus seulement
    "Commerce VN": (["Commercial", "Chargé de clientèle"], ["Agent logistique"]),
    "Commerce Pièces": (["Vendeur pièces"], ["Magasinier"]),
    "Pneumatique": (["Vendeur pièces"], ["Magasinier", "Chauffeur"]),
    "SAV PL": (["Conseiller SAV"], ["Technicien SAV", "Mécanicien"]),
    "SAV Engins": (["Conseiller SAV"], ["Technicien SAV", "Mécanicien"]),
    "Sites Déportés": (["Chef d'agence"], ["Mécanicien", "Chauffeur", "Agent logistique"]),
    "Administration": (["Chef d'agence"], ["Comptable", "Assistant RH"]),
}
SALAIRE = {  # salaire brut garanti de base (2024), FCFA
    "Commercial": 520000,
    "Chargé de clientèle": 430000,
    "Agent logistique": 300000,
    "Vendeur pièces": 380000,
    "Magasinier": 260000,
    "Chauffeur": 220000,
    "Conseiller SAV": 470000,
    "Technicien SAV": 410000,
    "Mécanicien": 340000,
    "Chef d'agence": 820000,
    "Comptable": 560000,
    "Assistant RH": 450000,
}
ASSURANCE = {"CDI": 25000, "CDD": 15000, "MAD": 0, "Stage": 0}
PRENOMS = [
    "Amina",
    "Boris",
    "Carine",
    "Didier",
    "Estelle",
    "Fabrice",
    "Gisèle",
    "Hervé",
    "Inès",
    "Jules",
    "Karine",
    "Léon",
    "Mireille",
    "Nadège",
    "Olivier",
    "Pascal",
    "Quentin",
    "Rose",
    "Serge",
    "Thérèse",
    "Ulrich",
    "Vanessa",
    "William",
    "Yvette",
    "Zacharie",
]
NOMS = [
    "Abena",
    "Bekono",
    "Choupo",
    "Djomo",
    "Essomba",
    "Fotso",
    "Guiadem",
    "Hamadou",
    "Ivaha",
    "Kamga",
    "Lobe",
    "Mbarga",
    "Ndzana",
    "Onana",
    "Pouth",
    "Tchakounte",
    "Wamba",
    "Yemba",
    "Zang",
    "Atangana",
]


def cle(a: int, m: int) -> int:
    return a * 100 + m


def mois_entre(debut: tuple[int, int], fin: tuple[int, int]) -> list[tuple[int, int]]:
    a, m, sortie = *debut, []
    while cle(a, m) <= cle(*fin):
        sortie.append((a, m))
        a, m = (a + 1, 1) if m == 12 else (a, m + 1)
    return sortie


def _employes(rng: random.Random) -> list[dict]:
    """Effectif permanent : 98 salariés répartis sur les 7 services (14 chacun)."""
    noms = [f"{n} {p}" for n in NOMS for p in PRENOMS]
    rng.shuffle(noms)
    services = list(POSTES)
    emps = []
    for i in range(1, 99):
        service = services[(i - 1) % 7]
        front = rng.random() < 0.45
        poste = rng.choice(POSTES[service][0 if front else 1])
        contrat = rng.choices(["CDI", "CDD", "MAD"], [70, 15, 15])[0]
        emps.append(
            {
                "matricule": f"EMP{i:03d}",
                "nom": noms[i - 1],
                "poste": poste,
                "contrat": contrat,
                "activite": FRONT if front else BACK,
                "service": service,
                "site": rng.choice(SITES[service]),
                "coef": round(rng.uniform(0.9, 1.12), 3),
                "entree": DEBUT,
                "sortie": None,
                "pauses": [],
                "changements": {},
            }
        )
    return emps


def generer(
    fin: tuple[int, int] = (2026, 10), graine: int = 2024
) -> tuple[list[str], list[list], list[str]]:
    """Renvoie (entêtes, lignes, cas couverts). Aucun événement n'a lieu le dernier mois."""
    rng = random.Random(graine)
    emps = _employes(rng)
    par_mat = {e["matricule"]: e for e in emps}
    notes: list[str] = []
    proteges = {"EMP001", "EMP015"}  # utilisés tels quels par la recette Playwright

    def pick(cond, nom_cas: str) -> dict:
        e = next(e for e in emps if e["matricule"] not in proteges and not e.get("cas") and cond(e))
        e["cas"] = nom_cas
        return e

    def changer(e: dict, quand: tuple[int, int], **attrs) -> None:
        e["changements"].setdefault(cle(*quand), {}).update(attrs)

    # EMP015 : Commerce VN en CDI jusqu'en décembre 2025, puis SAV PL (changement de périmètre).
    e = par_mat["EMP015"]
    e.update(
        service="Commerce VN", site="Douala", contrat="CDI", activite=FRONT, poste="Commercial"
    )
    changer(e, (2026, 1), service="SAV PL", poste="Conseiller SAV")
    notes.append("EMP015 : mutation Commerce VN -> SAV PL en janvier 2026 (change de périmètre)")
    e = par_mat["EMP001"]
    e.update(contrat="CDI")
    notes.append(f"EMP001 : présent tous les mois, sans événement ({e['service']})")

    # Entrées étalées et sorties définitives.
    for quand in [(2024, 3), (2024, 9), (2025, 1), (2025, 5), (2025, 10), (2026, 2), (2026, 4)]:
        e = pick(lambda e: True, "entree")
        e["entree"] = quand
        notes.append(f"{e['matricule']} : entrée en {MOIS[quand[1] - 1].lower()} {quand[0]}")
    for quand in [(2024, 6), (2024, 12), (2025, 3), (2025, 8), (2025, 12), (2026, 3)]:
        e = pick(lambda e: True, "sortie")
        e["sortie"] = quand
        notes.append(
            f"{e['matricule']} : dernier mois de paie en {MOIS[quand[1] - 1].lower()} {quand[0]}"
        )
    e = pick(lambda e: True, "pause")
    e["pauses"] = [(cle(2025, 7), cle(2025, 9))]
    notes.append(f"{e['matricule']} : absent des paies de juillet à septembre 2025, puis retour")

    # Mutations de service et de site.
    e = pick(lambda e: e["service"] == "Commerce Pièces", "mutation service")
    changer(e, (2025, 4), service="Pneumatique")
    notes.append(f"{e['matricule']} : mutation Commerce Pièces -> Pneumatique en avril 2025")
    e = pick(lambda e: e["service"] == "SAV PL" and e["site"] == "Douala", "vers déporté")
    changer(e, (2025, 10), site="Dehane")
    notes.append(f"{e['matricule']} : Douala -> Dehane en octobre 2025 (logement ajouté)")
    e = pick(lambda e: e["service"] == "SAV Engins" and e["site"] in DEPORTES, "retour agence")
    changer(e, (2025, 3), site="Garoua")
    notes.append(f"{e['matricule']} : site déporté -> Garoua en mars 2025 (logement retiré)")
    e = pick(lambda e: e["service"] == "Sites Déportés", "changement site déporté")
    changer(e, (2024, 11), site="Njombe" if e["site"] != "Njombe" else "Dimon")
    notes.append(f"{e['matricule']} : changement de site déporté en novembre 2024")

    # Changements de contrat, promotion, passage back -> front office.
    for avant, apres, quand in [
        ("CDD", "CDI", (2026, 1)),
        ("MAD", "CDI", (2025, 4)),
        ("CDD", "CDI", (2024, 7)),
    ]:
        e = pick(lambda e, a=avant: e["contrat"] == a, f"{avant}->{apres}")
        changer(e, quand, contrat=apres)
        notes.append(
            f"{e['matricule']} : {avant} -> {apres} en {MOIS[quand[1] - 1].lower()} {quand[0]}"
        )
    e = pick(lambda e: e["poste"] == "Technicien SAV", "promotion")
    changer(e, (2025, 7), poste="Conseiller SAV", activite=FRONT, coef=e["coef"] * 1.12)
    notes.append(
        f"{e['matricule']} : promotion Technicien SAV -> Conseiller SAV "
        "(back -> front office, +12 %) en juillet 2025"
    )

    # Stagiaires : un stagiaire long passé en CDD, des stagiaires d'été, un stagiaire sans paie.
    base = len(emps)

    def stagiaire(num: int, service: str, entree, sortie) -> dict:
        nom = f"{NOMS[num % len(NOMS)]} {PRENOMS[(num * 7) % len(PRENOMS)]}-Stage"
        s = {
            "matricule": f"EMP{num:03d}",
            "nom": nom,
            "poste": POSTES[service][1][0],
            "contrat": "Stage",
            "activite": BACK,
            "service": service,
            "site": SITES[service][0],
            "coef": 1.0,
            "entree": entree,
            "sortie": sortie,
            "pauses": [],
            "changements": {},
        }
        emps.append(s)
        return s

    s = stagiaire(base + 101, "Administration", (2024, 3), None)
    changer(s, (2024, 9), contrat="CDD")
    notes.append(f"{s['matricule']} : stage de mars à août 2024, puis CDD en septembre 2024")
    ete = list(POSTES)
    for annee in (2024, 2025, 2026):
        for k in range(3):
            stagiaire(200 + (annee - 2024) * 10 + k, ete[(annee + k) % 7], (annee, 7), (annee, 8))
    notes.append("EMP200..EMP222 : stagiaires d'été (juillet-août de chaque année)")
    sans_paie = next(e for e in emps if e["matricule"] == "EMP202")
    sans_paie["sans_paie"] = True
    notes.append(
        f"{sans_paie['matricule']} : stagiaire sans aucune paie (aucun avertissement attendu)"
    )

    negatif = pick(lambda e: e["contrat"] == "CDI", "négatif")["matricule"]
    notes.append(
        f"{negatif} : régularisation négative de primes exceptionnelles "
        "en février 2025 (avertissement)"
    )
    absent = pick(lambda e: e["contrat"] == "CDI", "absence longue")["matricule"]
    notes.append(f"{absent} : absence longue (20 jours) en novembre 2024")
    notes += [
        "Primes sur ventes : fins de trimestre, front office Commerce VN / Pièces / Pneumatique",
        "Primes sur résultats : décembre de chaque année, Administration en CDI",
        "Productivité Ateliers : chaque mois, back office SAV PL et SAV Engins",
        "Décembre : primes exceptionnelles des CDI ; bonus en juin et décembre",
        "Pics d'absences : avril 2026 et août de chaque année",
        "MAD : TVA & Marge MAD (18 %), sans charges patronales ; Stage : indemnité seule",
        "Salaire brut garanti +3 % chaque janvier",
    ]

    lignes = []
    for a, m in mois_entre(DEBUT, fin):
        k = cle(a, m)
        for e in emps:
            if k < cle(*e["entree"]) or (e["sortie"] and k > cle(*e["sortie"])):
                continue
            if any(d <= k <= f for d, f in e["pauses"]):
                continue
            etat = dict(e)
            for quand in sorted(e["changements"]):
                if quand <= k:
                    etat.update(e["changements"][quand])
            lignes.append(_ligne(rng, etat, a, m, negatif, absent))
    return list(ENTETES), lignes, notes


def _ligne(rng: random.Random, e: dict, a: int, m: int, negatif: str, absent: str) -> list:
    v = dict.fromkeys(ENTETES[9:], 0)
    for c in (
        "Primes sur ventes",
        "Primes sur résultats",
        "Productivité Ateliers",
        "TVA & Marge MAD",
    ):
        v[c] = None
    info = [
        a,
        MOIS[m - 1],
        e["matricule"],
        e["nom"],
        e["poste"],
        e["contrat"],
        e["activite"],
        e["site"],
        e["service"],
    ]
    if e.get("sans_paie"):
        return info + [None] * (len(ENTETES) - 9)
    front, contrat, service = e["activite"] == FRONT, e["contrat"], e["service"]
    if contrat == "Stage":
        v["Salaire brut garantie"] = 80000
        v["Absences (nb)"] = rng.choice([0, 0, 1])
    else:
        v["Salaire brut garantie"] = round(SALAIRE[e["poste"]] * e["coef"] * 1.03 ** (a - 2024))
        if service.startswith("SAV") or e["site"] in DEPORTES:
            v["Frais de mission"] = rng.choice([0, 0, 15000, 25000, 30000, 40000, 60000, 80000])
        if e["site"] in DEPORTES:
            v["Logement site déporté"] = 60000
        if e["poste"] in ("Chef d'agence", "Commercial"):
            v["Carburant véhicule service"] = 45000 if e["poste"] == "Chef d'agence" else 30000
        if front:
            v["Crédit téléphonique"] = rng.choice([10000, 15000, 20000])
        if front and service.startswith("Commerce") or service == "Pneumatique" and front:
            v["Variable"] = rng.randrange(0, 120000, 1000)
        if m in (6, 12) and rng.random() < 0.3:
            v["Bonus"] = rng.choice([30000, 70000])
        if m == 12 and contrat == "CDI":
            v["Primes exceptionnelles"] = 100000
        elif rng.random() < 0.06:
            v["Primes exceptionnelles"] = rng.choice([20000, 50000])
        if e["matricule"] == negatif and (a, m) == (2025, 2):
            v["Primes exceptionnelles"] = -20000
        if rng.random() < 0.05:
            v["Formation"] = 50000
        v["Assurance Maladie"] = ASSURANCE[contrat]
        pic = (a, m) == (2026, 4) or m == 8
        v["Absences (nb)"] = rng.choice([0, 1, 2, 3, 5] if pic else [0, 0, 0, 0, 1, 2, 3])
        if e["matricule"] == absent and (a, m) == (2024, 11):
            v["Absences (nb)"] = 20
        if (
            front
            and m in (3, 6, 9, 12)
            and (service.startswith("Commerce") or service == "Pneumatique")
        ):
            v["Primes sur ventes"] = 150000 if e["poste"] == "Commercial" else 90000
        if m == 12 and service == "Administration" and contrat == "CDI":
            v["Primes sur résultats"] = 250000
        if not front and service.startswith("SAV"):
            v["Productivité Ateliers"] = rng.choice([15000, 25000, 35000])
    brut = sum(
        v[c] or 0 for c in ("Salaire brut garantie", "Variable", "Bonus", "Primes sur ventes")
    )
    v["Brut Réel"] = brut
    if contrat == "MAD":
        v["TVA & Marge MAD"] = round(brut * 0.18, 2)
    elif contrat != "Stage":
        v["Charges Patronales"] = round(brut * 0.1654, 2)
    v["TOTAL CHARGES (FCFA)"] = round(
        brut
        + sum(
            v[c] or 0
            for c in (
                "Frais de mission",
                "Primes exceptionnelles",
                "Logement site déporté",
                "Carburant véhicule service",
                "Crédit téléphonique",
                "Charges Patronales",
                "Assurance Maladie",
                "Formation",
                "TVA & Marge MAD",
                "Primes sur résultats",
                "Productivité Ateliers",
            )
        ),
        2,
    )
    return info + [v[c] for c in ENTETES[9:]]


def lire_fin(texte: str) -> tuple[int, int]:
    a, m = texte.split("-")
    return int(a), int(m)


if __name__ == "__main__":
    import openpyxl

    ap = argparse.ArgumentParser()
    ap.add_argument("--fin", type=lire_fin, default=(2026, 10))
    ap.add_argument("sortie", type=Path, nargs="?", default=Path("historique_fictif.xlsx"))
    args = ap.parse_args()
    entetes, lignes, notes = generer(args.fin)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "DONNEES"
    ws["B1"] = "FEUILLE DE DONNÉES CENTRALE (fictive)"
    for i, h in enumerate(entetes):
        ws.cell(3, i + 2, h)
    for n, r in enumerate(lignes, start=4):
        for i, x in enumerate(r):
            ws.cell(n, i + 2, x)
    wb.save(args.sortie)
    print(f"{args.sortie} : {len(lignes)} lignes")
    print("Cas :\n- " + "\n- ".join(notes))
