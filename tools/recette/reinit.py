"""Base de recette : repart de zéro à chaque passage, toujours avec les mêmes données.

Usage (API arrêtée, depuis backend/) : .venv/Scripts/python ../tools/recette/reinit.py
Options : --base recette.db (fichier SQLite, dans backend/), --historique <xlsx>.
Mot de passe : RECETTE_PASSWORD pour tous les comptes, sinon <début de l'adresse><suffixe-retire>
(admin@exemple.invalid -> <mot-de-passe-recette>).

Contenu : comptes de comptes.csv, historique de paie (Excel REPORTING RH, 18 mois),
CA et marge de ca_marge.csv, budgets de budgets.csv. Les mois suivants restent vides :
ils servent au test d'import en direct (voir LISEZMOI.md).
"""

import argparse
import csv
import os
import subprocess
import sys
from pathlib import Path

ICI = Path(__file__).resolve().parent
BACKEND = ICI.parent.parent / "backend"
HISTORIQUE = ICI.parent.parent.parent / "Reporting RH" / "REPORTING_RH_V4.xlsx"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _csv(nom: str) -> list[dict]:
    with open(ICI / nom, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f, delimiter=";"))


MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août",
        "Septembre", "Octobre", "Novembre", "Décembre"]


def _num(m: str) -> int:
    return MOIS.index(m.replace("\xa0", " ").strip().capitalize()) + 1


def historique_recette(source: Path) -> tuple[bytes, list[str]]:
    """Valeurs de la feuille DONNEES + scénarios ajoutés (mutations, retour, primes exclues,
    pic de fin d'année, pic d'absences). Choix déterministes : mêmes données à chaque passage."""
    import io

    import openpyxl

    ws = openpyxl.load_workbook(source, data_only=True)["DONNEES"]
    entetes = [ws.cell(3, c).value for c in range(2, 29)]  # B3 : ANNÉE … AB3 : Productivité
    col = {h: i for i, h in enumerate(entetes)}
    lignes = [list(r) for r in ws.iter_rows(min_row=4, min_col=2, max_col=28, values_only=True)
              if r[0]]
    cle = lambda r: r[col["ANNÉE"]] * 100 + _num(r[col["MOIS"]])  # noqa: E731
    mois = sorted({cle(r) for r in lignes})
    par_mat: dict[str, list[list]] = {}
    for r in lignes:
        par_mat.setdefault(r[col["MATRICULE"]], []).append(r)
    complets = sorted(m for m, rs in par_mat.items() if len(rs) == len(mois))

    def premier(cond) -> str:
        return next(m for m in complets if cond(par_mat[m][0]) and m not in pris)

    pris: set[str] = set()
    notes: list[str] = []

    m = premier(lambda r: r[col["Service"]] == "Commerce VN" and r[col["Type Contrat"]] == "CDI")
    pris.add(m)
    for r in par_mat[m]:
        if cle(r) >= 202601:
            r[col["Service"]] = "SAV PL"
    notes.append(f"{m} : mutation Commerce VN -> SAV PL en janvier 2026 (change de périmètre)")

    m = premier(lambda r: r[col["Site"]] in ("Douala", "Yaoundé")
                and not r[col["Logement site déporté"]])
    pris.add(m)
    for r in par_mat[m]:
        if cle(r) >= 202510:
            r[col["Site"]], r[col["Logement site déporté"]] = "Dehane", 60000
    notes.append(f"{m} : mutation agence -> site déporté Dehane en octobre 2025 (+ logement)")

    m = premier(lambda r: r[col["Type Contrat"]] == "CDD")
    pris.add(m)
    for r in par_mat[m]:
        if cle(r) >= 202601:
            r[col["Type Contrat"]] = "CDI"
    notes.append(f"{m} : CDD -> CDI en janvier 2026")

    m = premier(lambda r: r[col["Type Contrat"]] == "CDI")
    pris.add(m)
    retour = {202507, 202508, 202509}
    lignes = [r for r in lignes if not (r[col["MATRICULE"]] == m and cle(r) in retour)]
    notes.append(f"{m} : départ fin juin 2025, retour en octobre 2025")

    for r in lignes:
        k, svc, act = cle(r), r[col["Service"]], r[col["Activité"]]
        if svc == "Commerce VN" and act == "Front office" and k % 100 in (3, 6, 9, 12):
            r[col["Primes sur ventes"]] = 150000
        if k == 202512 and svc == "Administration" and r[col["Type Contrat"]] == "CDI":
            r[col["Primes sur résultats"]] = 250000
        if k >= 202601 and svc in ("SAV PL", "SAV Engins") and act == "Back Office":
            r[col["Productivité Ateliers"]] = 25000
        if k == 202512 and r[col["Type Contrat"]] == "CDI":
            r[col["Primes exceptionnelles"]] = (r[col["Primes exceptionnelles"]] or 0) + 100000
        if k == 202604 and int(r[col["MATRICULE"]][3:]) % 5 == 0:
            r[col["Absences (nb)"]] = 2 + int(r[col["MATRICULE"]][3:]) % 4
    notes += [
        "Primes sur ventes (exclues du total) : Commerce VN front office, fins de trimestre",
        "Primes sur résultats (exclues) : Administration CDI, décembre 2025",
        "Productivité ateliers (exclue) : SAV PL et SAV Engins back office, depuis janvier 2026",
        "Pic de fin d'année : +100 000 de primes exceptionnelles par CDI en décembre 2025",
        "Pic d'absences : avril 2026 (2 à 5 jours pour un salarié sur cinq)",
    ]

    wb = openpyxl.Workbook()
    out = wb.active
    out.title = "DONNEES"
    out["B1"] = "FEUILLE DE DONNÉES CENTRALE (recette)"
    out["B2"] = "Historique de recette généré par tools/recette/reinit.py"
    for i, h in enumerate(entetes):
        out.cell(3, i + 2, h)
    for n, r in enumerate(lignes, start=4):
        for i, v in enumerate(r):
            out.cell(n, i + 2, v)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue(), notes


def _preparer(base: str) -> None:
    fichier = BACKEND / base
    try:
        fichier.unlink(missing_ok=True)
    except PermissionError:
        sys.exit(f"{base} est ouvert : arrêter l'API puis relancer")
    os.environ.update(
        DATABASE_URL=f"sqlite:///{base}", ENV="test", COOKIE_SECURE="false",
        SECRET_KEY=os.environ.get("SECRET_KEY", "<cle-de-test>"),
    )
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND,
                   check=True, capture_output=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="recette.db")
    ap.add_argument("--historique", type=Path, default=HISTORIQUE)
    args = ap.parse_args()
    commun = os.environ.get("RECETTE_PASSWORD")

    def mdp(email: str) -> str:
        return commun or email.strip().lower().split("@")[0] + "<suffixe-retire>"

    comptes = _csv("comptes.csv")
    admins = [c for c in comptes if c["modele"] == "admin"]
    if not admins:
        sys.exit("comptes.csv : au moins un compte de modèle admin requis")
    _preparer(args.base)
    os.chdir(BACKEND)
    sys.path.insert(0, str(BACKEND))

    from fastapi.testclient import TestClient
    from sqlalchemy import select

    from app.db.session import SessionLocal
    from app.main import app
    from app.models.auth import Perimetre, Utilisateur
    from app.models.referentiel import Rubrique, Service, Site
    from app.seed import _user, run

    with SessionLocal() as db:
        run(db, admins[0]["email"], mdp(admins[0]["email"]), None)
        perim = {p.code: p.id for p in db.scalars(select(Perimetre))}
        for c in comptes:
            email = c["email"].strip().lower()
            _user(db, email, c["nom"], mdp(c["email"]), c["modele"],
                  perim[c["perimetre"]] if c["perimetre"] else None, c["nominatif"] == "oui")
            # Le premier admin existe déjà (créé par run avec un nom générique) : nom du CSV.
            db.flush()
            u = db.scalar(select(Utilisateur).where(Utilisateur.email == email))
            u.nom, u.fonction = c["nom"], c["fonction"] or u.fonction
        db.commit()
        cibles = {
            "service": {s.libelle: s.id for s in db.scalars(select(Service))},
            "site": {s.libelle: s.id for s in db.scalars(select(Site))},
            "rubrique": {r.libelle: r.id for r in db.scalars(select(Rubrique))},
        }

    c = TestClient(app)
    api = "/api/v1"
    admin = admins[0]["email"]
    r = c.post(f"{api}/auth/login", json={"email": admin, "password": mdp(admin)})
    assert r.status_code == 200, r.text
    contenu, notes = historique_recette(args.historique)
    fichier = ("historique_recette.xlsx", contenu, XLSX)
    lot = c.post(f"{api}/imports", files={"fichier": fichier}).json()
    if lot.get("statut") != "pret":
        sys.exit(f"Import de l'historique non prêt : {lot.get('statut')} "
                 f"({lot.get('nb_bloquants')} bloquant(s), {lot.get('nb_avert')} avertissement(s))")
    r = c.post(f"{api}/imports/{lot['id']}/valider")
    assert r.status_code == 200, r.text

    for m in _csv("ca_marge.csv"):
        if m["ca"]:
            r = c.put(f"{api}/pilotage/ca-marge", json={
                "annee": int(m["annee"]), "mois": int(m["mois"]),
                "ca": m["ca"], "marge": m["marge"] or None})
            assert r.status_code == 200, (m, r.text)

    par_mois: dict[tuple[int, int], list[dict]] = {}
    for b in _csv("budgets.csv"):
        cible = cibles[b["axe"]].get(b["cible"])
        if cible is None:
            sys.exit(f"budgets.csv : {b['axe']} inconnu « {b['cible']} »")
        par_mois.setdefault((int(b["annee"]), int(b["mois"])), []).append(
            {"axe": b["axe"], "cible_id": cible, "valeur": b["valeur"]})
    for (annee, mois), lignes in par_mois.items():
        r = c.put(f"{api}/pilotage/budgets", json={"annee": annee, "mois": mois, "lignes": lignes})
        assert r.status_code == 200, r.text

    print(f"Base {args.base} prête : {lot['nb_lignes']} lignes de paie, "
          f"{len(comptes)} comptes (mot de passe : {commun or '<début de l’adresse><suffixe-retire>'}).")
    print("Scénarios :\n- " + "\n- ".join(notes))


if __name__ == "__main__":
    main()
