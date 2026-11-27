"""Profil du salarié : lecture à l'import (xlsx, paie CSV), enregistrement, calcul et masque de l'API."""

from datetime import date
from decimal import Decimal as D

import pytest
from sqlalchemy import select

from app.imports.lecture import lire
from app.imports.paie import lire_csv
from app.imports.regles import (
    AVERT,
    BLOQUANT,
    CIVILITE_COLONNE,
    EMBAUCHE_COLONNE,
    NAISSANCE_COLONNE,
    lire_date,
    sexe_de,
    valider,
)
from app.kpi.moteur import Ligne, PeriodeData, profil
from app.models.donnees import Salarie
from tests.test_import_paie import ENTETE, LIENS, RUBRIQUES, csv_bytes, employe
from tests.test_import_regles import ENTETES, ligne, refs, xlsx
from tests.test_rapports_api import ADMIN, API, EQUIP, XLSX, get

PROFIL = [CIVILITE_COLONNE, NAISSANCE_COLONNE, EMBAUCHE_COLONNE]
ENTETES_PROFIL = ENTETES + PROFIL
CODES_PROFIL = ("CIVILITE_INCONNUE", "DATE_INVALIDE", "DATE_INCOHERENTE")


def lig(civilite=None, naissance=None, embauche=None, **kw):
    return ligne(**kw) + [civilite, naissance, embauche]


def run(lignes, entetes=ENTETES_PROFIL):
    return valider(lire(xlsx(lignes, entetes)), refs())


# ---------- lecture des valeurs ----------
@pytest.mark.parametrize("texte, attendu", [
    ("M", "H"), ("M.", "H"), ("Mr", "H"), ("monsieur", "H"), ("H", "H"), ("Homme", "H"),
    ("Mme", "F"), ("MME.", "F"), ("Madame", "F"), ("Mlle", "F"), ("Mademoiselle", "F"),
    ("f", "F"), ("Femme", "F"), ("Dr", None), ("X", None),
])
def test_civilite_vers_sexe(texte, attendu):
    assert sexe_de(texte) == attendu


@pytest.mark.parametrize("v, attendu", [
    ("12/03/1990", date(1990, 3, 12)), ("1990-03-12", date(1990, 3, 12)),
    ("12-03-1990", date(1990, 3, 12)), ("1990-03-12 00:00:00", date(1990, 3, 12)),
    (date(1990, 3, 12), date(1990, 3, 12)), ("31/02/1990", None), ("hier", None),
])
def test_lire_date(v, attendu):
    assert lire_date(v) == attendu


# ---------- import xlsx ----------
def test_import_xlsx_trois_colonnes():
    L, anos, _ = run([lig("Mme", "12/03/1990", date(2020, 1, 5))])
    assert (L[0].sexe, L[0].date_naissance, L[0].date_embauche) == ("F", date(1990, 3, 12), date(2020, 1, 5))
    assert (L[0].civilite_presente, L[0].naissance_presente, L[0].embauche_presente) == (True,) * 3
    assert not [a for a in anos if a.code in CODES_PROFIL]


def test_import_xlsx_avertissements_non_bloquants():
    L, anos, _ = run([
        lig("Dr", "n'importe quoi", "2020-01-05", MATRICULE="E1"),
        lig("M", "01/01/1850", "01/02/2026", MATRICULE="E2"),   # naissance < 1900, embauche après le mois
        lig("M", "15/01/2026", "14/01/2026", MATRICULE="E3"),   # embauche avant la naissance
        lig("M", "01/02/2026", None, MATRICULE="E4"),           # naissance après la fin du mois
    ])
    vus = {(a.ligne, a.colonne, a.code, a.gravite) for a in anos if a.code in CODES_PROFIL}
    assert vus == {
        (2, CIVILITE_COLONNE, "CIVILITE_INCONNUE", AVERT),
        (2, NAISSANCE_COLONNE, "DATE_INVALIDE", AVERT),
        (3, NAISSANCE_COLONNE, "DATE_INCOHERENTE", AVERT),
        (3, EMBAUCHE_COLONNE, "DATE_INCOHERENTE", AVERT),
        (4, EMBAUCHE_COLONNE, "DATE_INCOHERENTE", AVERT),
        (5, NAISSANCE_COLONNE, "DATE_INCOHERENTE", AVERT),
    }
    assert not [a for a in anos if a.gravite == BLOQUANT]
    assert L[0].sexe is None and L[0].date_naissance is None and L[0].date_embauche == date(2020, 1, 5)
    assert L[1].date_naissance is None and L[1].date_embauche is None
    assert L[2].date_naissance == date(2026, 1, 15) and L[2].date_embauche is None


def test_import_xlsx_colonnes_absentes():
    L, anos, _ = run([ligne()], ENTETES)
    assert (L[0].civilite_presente, L[0].naissance_presente, L[0].embauche_presente) == (False,) * 3
    assert L[0].sexe is None and not [a for a in anos if a.code in CODES_PROFIL]


def test_import_xlsx_alias_d_entetes():
    entetes = ENTETES + ["Sexe", "Date naissance", "Date d'entrée"]
    L, _, _ = run([ligne() + ["F", "01/01/1990", "01/01/2020"]], entetes)
    assert (L[0].sexe, L[0].date_naissance, L[0].date_embauche) == ("F", date(1990, 1, 1), date(2020, 1, 1))


# ---------- enregistrement du lot ----------
def charger(c, lignes, entetes=ENTETES_PROFIL):
    lot = c.post(f"{API}/imports", files={"fichier": ("a.xlsx", xlsx(lignes, entetes), XLSX)}).json()
    assert lot["statut"] == "pret", lot
    assert c.post(f"{API}/imports/{lot['id']}/valider").status_code == 200


def profil_de(db, matricule):
    db.expire_all()
    s = db.scalar(select(Salarie).where(Salarie.matricule == matricule))
    return s.sexe, s.date_naissance, s.date_embauche


def test_valeurs_conservees_et_mois_recent_gagne(make_client, db):
    c = make_client(ADMIN)
    charger(c, [lig("Mme", "12/03/1990", "05/01/2020", MATRICULE="E1")])
    connu = ("F", date(1990, 3, 12), date(2020, 1, 5))
    assert profil_de(db, "E1") == connu
    # colonnes absentes : rien n'est effacé
    charger(c, [ligne(MOIS="Février", MATRICULE="E1")], ENTETES)
    assert profil_de(db, "E1") == connu
    # colonnes vides ou illisibles : rien n'est effacé non plus
    charger(c, [lig(None, "n'importe quoi", None, MOIS="Mars", MATRICULE="E1")])
    assert profil_de(db, "E1") == connu
    # deux lignes du même salarié dans un lot : le mois le plus récent l'emporte, même écrit avant
    charger(c, [lig("M", "01/01/1991", None, MOIS="Mai", MATRICULE="E1"),
                lig("Mme", "02/02/1992", None, MOIS="Avril", MATRICULE="E1")])
    assert profil_de(db, "E1") == ("H", date(1991, 1, 1), date(2020, 1, 5))


def test_avertissements_a_l_import_api(make_client):
    c = make_client(ADMIN)
    lot = c.post(f"{API}/imports", files={"fichier": ("a.xlsx", xlsx(
        [lig("Dr", "pas une date", "01/01/1850", MATRICULE="E1")], ENTETES_PROFIL), XLSX)}).json()
    assert lot["statut"] == "pret"
    codes = {a["code"] for a in c.get(f"{API}/imports/{lot['id']}/anomalies").json()}
    assert {"CIVILITE_INCONNUE", "DATE_INVALIDE"} <= codes


# ---------- import paie CSV ----------
def test_paie_csv_colonnes_du_profil():
    entete = [*ENTETE, "Civilité", "Date de naissance", "Date d'embauche"]
    f = lire_csv(csv_bytes([[*employe(), "Mme", "12/03/1990", "05/01/2020"]], entete=entete),
                 RUBRIQUES, LIENS, 2026, 10)
    L, anos, _ = valider(f, refs(postes={"conseiller"}, postes_activite={"conseiller": "Front office"}))
    assert (L[0].sexe, L[0].date_naissance, L[0].date_embauche) == ("F", date(1990, 3, 12), date(2020, 1, 5))
    assert not [a for a in anos if a.gravite == BLOQUANT or a.code in CODES_PROFIL], anos


def test_paie_csv_sans_colonnes_du_profil():
    f = lire_csv(csv_bytes([employe()]), RUBRIQUES, LIENS, 2026, 10)
    assert not set(PROFIL) & set(f.entetes)


# ---------- moteur ----------
FIN = date(2026, 1, 31)


def pers(sid, sexe=None, naissance=None, embauche=None):
    return Ligne(sid, "SAV PL", "Douala", "Front office", "CDI", sexe=sexe, date_naissance=naissance,
                 date_embauche=embauche)


def prof(*lignes, fin=FIN):
    return profil(PeriodeData(tuple(lignes), fin=fin))


def n_tranches(bloc):
    return {t["cle"]: t["n"] for t in bloc["tranches"]}


def test_profil_absent():
    assert profil(None) is None
    assert prof(pers(1), fin=None) is None


def test_profil_bornes_age():
    p = prof(pers(1, naissance=date(2001, 1, 31)),     # 25 ans pile
             pers(2, naissance=date(2001, 2, 1)),      # 24 ans et 11 mois
             pers(3, naissance=date(1992, 1, 31)),     # 34 ans
             pers(4, naissance=date(1991, 1, 31)),     # 35 ans
             pers(5, naissance=date(1971, 1, 31)),     # 55 ans
             pers(6, naissance=date(1971, 2, 1)))      # 54 ans et 11 mois
    assert [t["cle"] for t in p["age"]["tranches"]] == ["<25", "25-34", "35-44", "45-54", "55+"]
    assert n_tranches(p["age"]) == {"<25": 1, "25-34": 2, "35-44": 1, "45-54": 1, "55+": 1}
    assert p["age"]["nr"] == 0 and p["effectif"] == 6


def test_profil_bornes_anciennete():
    p = prof(pers(1, embauche=date(2025, 2, 1)),       # 11 mois
             pers(2, embauche=date(2025, 1, 31)),      # 1 an
             pers(3, embauche=date(2023, 2, 1)),       # 2 ans et 11 mois
             pers(4, embauche=date(2023, 1, 31)),      # 3 ans
             pers(5, embauche=date(2021, 1, 31)),      # 5 ans
             pers(6, embauche=date(2016, 2, 1)),       # 9 ans et 11 mois
             pers(7, embauche=date(2016, 1, 31)),      # 10 ans
             pers(8, embauche=FIN))                    # embauché le dernier jour : 0 an
    assert [t["cle"] for t in p["anciennete"]["tranches"]] == ["<1", "1-3", "3-5", "5-10", "10+"]
    assert n_tranches(p["anciennete"]) == {"<1": 2, "1-3": 2, "3-5": 1, "5-10": 2, "10+": 1}


def test_profil_moyennes_et_non_renseignes():
    p = prof(pers(1, "H", date(2000, 1, 31), date(2020, 1, 31)),    # 26 ans, 6 ans
             pers(2, "F", date(2002, 1, 31), date(2024, 1, 31)),    # 24 ans, 2 ans
             pers(3),
             pers(3))                                               # même salarié : compté une fois
    assert p["effectif"] == 3
    assert p["sexe"] == {"H": 1, "F": 1, "nr": 1}
    assert p["age"]["moyenne"] == D(25) and p["age"]["nr"] == 1
    assert p["anciennete"]["moyenne"] == D(4) and p["anciennete"]["nr"] == 1
    vide = prof(pers(1))
    assert vide["age"]["moyenne"] is None and vide["anciennete"]["moyenne"] is None
    assert vide["age"]["nr"] == vide["anciennete"]["nr"] == 1


def test_profil_moyenne_en_mois_revolus():
    p = prof(pers(1, naissance=date(2000, 7, 31)), pers(2, naissance=date(2001, 1, 31)))
    # 25 ans et 6 mois, 25 ans : 606 mois sur 2 personnes
    assert p["age"]["moyenne"] == D(606) / D(24)


def test_profil_embauche_future_non_renseignee():
    p = prof(pers(1, embauche=date(2026, 2, 1)), pers(2, embauche=date(2020, 1, 31)))
    assert p["anciennete"]["nr"] == 1 and p["anciennete"]["moyenne"] == D(6)


# ---------- API /annuel ----------
def donnees():
    jan = [
        lig("Mme", "12/03/1990", "05/01/2020", MATRICULE="E1", Noms="Ann", Service="SAV PL"),
        lig("M", "01/06/1980", "01/09/2010", MATRICULE="E2", Noms="Bob", Service="Commerce VN",
            Site="Yaoundé"),
        lig(None, None, None, MATRICULE="E3", Noms="Cy", Service="Administration", Site="Yaoundé",
            **{"Type Contrat": "CDD"}),
        lig("Mme", "12/03/1995", "05/01/2021", MATRICULE="E4", Noms="Dee", Service="SAV PL"),
        lig("M", "12/03/1999", "05/01/2022", MATRICULE="E6", Noms="Eve", Service="SAV PL"),
    ]
    fev = [
        lig("Mme", "12/03/1990", "05/01/2020", MOIS="Février", MATRICULE="E1", Noms="Ann",
            Service="SAV PL"),
        lig("M", "01/06/1980", "01/09/2010", MOIS="Février", MATRICULE="E2", Noms="Bob",
            Service="Commerce VN", Site="Yaoundé"),
    ]
    return jan + fev


@pytest.fixture()
def charge(make_client, db):
    c = make_client(ADMIN)
    charger(c, donnees())
    return c


def test_api_annuel_profil_et_contrat_fin(charge):
    r = get(charge, "annuel", annee=2026, mois=1).json()
    p = r["profil"]["m"]
    assert p["effectif"] == 5 and p["sexe"] == {"H": 2, "F": 2, "nr": 1}
    assert p["age"]["nr"] == 1 and p["anciennete"]["nr"] == 1
    assert D(p["age"]["moyenne"]) > 0
    assert r["profil"]["m1"] is None
    cf = r["contrat_fin"]
    assert (D(cf["CDI"]["m"]), D(cf["CDD"]["m"]), D(cf["autres"]["m"])) == (4, 1, 0)
    assert sum(D(cf[k]["m"]) for k in cf) == D(r["effectif_fin"]["m"]) == 5


def test_api_annuel_profil_masque_sous_le_seuil(charge, make_client):
    equip = make_client(EQUIP)  # périmètre SAV PL, sans accès nominatif
    jan = get(equip, "annuel", annee=2026, mois=1).json()["profil"]["m"]
    assert jan["effectif"] == 3 and "masque" not in jan and "age" in jan
    fev = get(equip, "annuel", annee=2026, mois=2).json()["profil"]["m"]
    assert fev == {"effectif": 1, "masque": True}
    # avec l'accès nominatif, le même groupe reste visible
    adm = get(charge, "annuel", annee=2026, mois=2, service="SAV PL").json()["profil"]["m"]
    assert adm["effectif"] == 1 and "masque" not in adm and adm["sexe"] == {"H": 0, "F": 1, "nr": 0}
