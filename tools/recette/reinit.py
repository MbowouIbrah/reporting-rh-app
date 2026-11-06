"""Base de recette : repart de zéro à chaque passage, toujours avec les mêmes données.

Usage (API arrêtée, depuis backend/) : .venv/Scripts/python ../tools/recette/reinit.py
Options : --base recette.db (fichier SQLite, dans backend/), --fin AAAA-MM (dernier mois de paie).
Comptes : comptes.local.csv (généré par generer_comptes.py à partir de comptes.exemple.csv, non suivi).

Contenu : comptes de comptes.local.csv, historique de paie 100 % fictif (donnees_fictives.py,
de janvier 2024 à --fin),
CA et marge de ca_marge.csv, activité fictive (activite_fictive.py),
objectifs annuels globaux (2024 à 2026), budgets de budgets.csv (jusqu'à --fin).
Les mois suivants restent vides :
ils servent au test d'import en direct (voir LISEZMOI.md).
"""

import argparse
import csv
import os
import secrets
import subprocess
import sys
from pathlib import Path

from generer_comptes import charger

ICI = Path(__file__).resolve().parent
BACKEND = ICI.parent.parent / "backend"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _csv(nom: str) -> list[dict]:
    with open(ICI / nom, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f, delimiter=";"))


MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août",
        "Septembre", "Octobre", "Novembre", "Décembre"]


def _num(m: str) -> int:
    return MOIS.index(m.replace("\xa0", " ").strip().capitalize()) + 1


def _mois_clos() -> tuple[int, int]:
    from datetime import date

    t = date.today()  # noqa: DTZ011 - mois local suffit
    return (t.year, t.month - 1) if t.month > 1 else (t.year - 1, 12)


def _lire_fin(texte: str) -> tuple[int, int]:
    a, m = texte.split("-")
    return int(a), int(m)


def historique_recette(fin: tuple[int, int] = (2026, 6)) -> tuple[bytes, list[str]]:
    """Historique 100 % fictif (donnees_fictives.py) de janvier 2024 à `fin`, avec l'activité
    fictive (activite_fictive.py). Tirage à graine fixe : mêmes données à chaque passage."""
    import io

    import openpyxl
    from activite_fictive import ajouter
    from donnees_fictives import generer

    entetes, lignes, notes = generer(fin)
    entetes, lignes = ajouter(entetes, lignes)
    wb = openpyxl.Workbook()
    out = wb.active
    out.title = "DONNEES"
    out["B1"] = "FEUILLE DE DONNÉES CENTRALE (recette)"
    out["B2"] = "Historique fictif généré par tools/recette/donnees_fictives.py"
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
        SECRET_KEY=os.environ.get("SECRET_KEY") or secrets.token_urlsafe(48),
    )
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND,
                   check=True, capture_output=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="recette.db")
    ap.add_argument("--fin", type=_lire_fin, default=_mois_clos(),
                    help="dernier mois de paie, AAAA-MM (défaut : dernier mois clos)")
    args = ap.parse_args()
    comptes = charger()
    mdp_de = {c["email"]: c["mot_de_passe"] for c in comptes}
    admins = [c for c in comptes if c["modele"] == "admin"]
    if not admins:
        sys.exit("comptes.local.csv : au moins un compte de modèle admin requis")
    _preparer(args.base)
    os.chdir(BACKEND)
    sys.path.insert(0, str(BACKEND))

    from app.db.session import SessionLocal
    from app.main import app
    from app.models.auth import Perimetre, Utilisateur
    from app.models.referentiel import Rubrique, Service, Site
    from app.seed import _user, run
    from fastapi.testclient import TestClient
    from sqlalchemy import select

    with SessionLocal() as db:
        run(db, admins[0]["email"], mdp_de[admins[0]["email"]], None, mdp_provisoire=False)
        perim = {p.code: p.id for p in db.scalars(select(Perimetre))}
        for c in comptes:
            email = c["email"].strip().lower()
            _user(db, email, c["nom"], c["mot_de_passe"], c["modele"],
                  perim[c["perimetre"]] if c["perimetre"] else None, c["nominatif"] == "oui",
                  provisoire=False)
            # Le premier admin existe déjà (créé par run avec un nom générique) : nom du CSV.
            db.flush()
            u = db.scalar(select(Utilisateur).where(Utilisateur.email == email))
            u.nom, u.fonction = c["nom"], c["fonction"] or u.fonction
        types_site = {
            "Yaoundé": "agence", "Douala": "principal", "Bertoua": "agence",
            "Ngaoundéré": "agence", "Garoua": "agence", "Dehane": "deporte",
            "Libongo": "deporte", "Njombe": "deporte", "Dimon": "deporte", "Nkoteng": "deporte",
        }
        for s in db.scalars(select(Site)):
            if s.libelle in types_site:
                s.type_site = types_site[s.libelle]
        db.commit()
        cibles = {
            "service": {s.libelle: s.id for s in db.scalars(select(Service))},
            "site": {s.libelle: s.id for s in db.scalars(select(Site))},
            "rubrique": {r.libelle: r.id for r in db.scalars(select(Rubrique))},
        }

    c = TestClient(app)
    api = "/api/v1"
    admin = admins[0]["email"]
    r = c.post(f"{api}/auth/login", json={"email": admin, "password": mdp_de[admin]})
    assert r.status_code == 200, r.text
    contenu, notes = historique_recette(args.fin)
    fichier = ("historique_recette.xlsx", contenu, XLSX)
    lot = c.post(f"{api}/imports", files={"fichier": fichier}).json()
    if lot.get("statut") != "pret":
        sys.exit(f"Import de l'historique non prêt : {lot.get('statut')} "
                 f"({lot.get('nb_bloquants')} bloquant(s), {lot.get('nb_avert')} avertissement(s))")
    r = c.post(f"{api}/imports/{lot['id']}/valider")
    assert r.status_code == 200, r.text

    for m in _csv("ca_marge.csv"):
        if m["ca"] and (int(m["annee"]), int(m["mois"])) <= args.fin:
            r = c.put(f"{api}/pilotage/saisies", json={
                "annee": int(m["annee"]), "mois": int(m["mois"]),
                "groupe": "ca_marge", "niveau": "global",
                "cases": [{"site_id": None, "service_id": None,
                           "valeurs": {"ca": m["ca"], "marge": m["marge"] or None}}]})
            assert r.status_code == 200, (m, r.text)

    # Objectifs annuels globaux, répartis en 12 mois par le serveur (le reste va sur décembre).
    objectifs = {"obj_ca_marge": {"obj_ca": "24000000000", "obj_marge": "3000000000"},
                 "obj_activite": {"obj_ventes": "1200", "obj_clients": "600", "obj_factures": "2400"}}
    for annee in (2024, 2025, 2026):
        for groupe, totaux in objectifs.items():
            r = c.put(f"{api}/pilotage/saisies/annee", json={
                "annee": annee, "groupe": groupe, "niveau": "global",
                "cases": [{"indicateur": i, "total": t} for i, t in totaux.items()]})
            assert r.status_code == 200, (annee, groupe, r.text)

    par_mois: dict[tuple[int, int], list[dict]] = {}
    for b in _csv("budgets.csv"):
        if (int(b["annee"]), int(b["mois"])) > args.fin:
            continue
        cible = cibles[b["axe"]].get(b["cible"])
        if cible is None:
            sys.exit(f"budgets.csv : {b['axe']} inconnu « {b['cible']} »")
        par_mois.setdefault((int(b["annee"]), int(b["mois"])), []).append(
            {"axe": b["axe"], "cible_id": cible, "valeur": b["valeur"]})
    for (annee, mois), lignes in par_mois.items():
        r = c.put(f"{api}/pilotage/budgets", json={"annee": annee, "mois": mois, "lignes": lignes})
        assert r.status_code == 200, r.text

    print(f"Base {args.base} prête : {lot['nb_lignes']} lignes de paie, "
          f"{len(comptes)} comptes (mots de passe dans tools/recette/comptes.local.csv).")
    print("Scénarios :\n- " + "\n- ".join(notes))


if __name__ == "__main__":
    main()
