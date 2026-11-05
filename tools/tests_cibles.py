"""Tests ciblés : ne relance que les tests liés aux fichiers modifiés.

Usage, depuis la racine du dépôt :
    python tools/tests_cibles.py              # changements non commités, lance les tests
    python tools/tests_cibles.py --depuis main  # tout ce qui diffère de main
    python tools/tests_cibles.py --voir        # affiche le plan sans rien lancer
    python tools/tests_cibles.py --carte       # suite backend complète + carte refaite
    python tools/tests_cibles.py --recette     # lance aussi la recette ciblée (Playwright)

Principe (un module testé seul, puis avec ceux qui l'utilisent) :
- Backend : la carte `backend/.carte-tests.json` dit, pour chaque fichier de app/, quels
  fichiers de test l'exécutent (mesure par couverture, `CARTE_TESTS=1`). Un fichier du socle
  (modèles, base, configuration, conftest) relance tout.
- Frontend : `vitest related` suit les imports ; `npm run build` vérifie les types partout.
- Recette : table ci-dessous, d'un dossier ou d'une page vers les specs qui l'exercent.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parents[1]
BACK = RACINE / "backend"
FRONT = RACINE / "frontend"
PY = BACK / ".venv" / "Scripts" / "python.exe"
CARTE = BACK / ".carte-tests.json"

# Changer un de ces fichiers peut toucher tous les tests : suite complète.
SOCLE_BACK = (
    "backend/app/models/",
    "backend/app/db/",
    "backend/app/core/",
    "backend/app/main.py",
    "backend/app/seed.py",
    "backend/app/referentiels_init.py",
    "backend/tests/conftest.py",
    "backend/requirements",
    "backend/pytest.ini",
)
SOCLE_FRONT = (
    "frontend/package.json",
    "frontend/package-lock.json",
    "frontend/vite.config.ts",
    "frontend/tsconfig.json",
    "frontend/src/setupTests.ts",
)

# Recette Playwright : préfixe de fichier -> specs. Absent de la table : pas de recette ciblée.
# "*" = recette complète (composant partagé par tous les écrans).
RECETTE = {
    "frontend/src/App.tsx": "*",
    "frontend/src/api/": "*",
    "frontend/src/auth/": ["40-utilisateurs", "profils"],
    "frontend/src/components/": "*",
    "frontend/src/lib/": "*",
    "frontend/src/styles/": "*",
    "frontend/src/pages/Login": ["40-utilisateurs", "profils"],
    "frontend/src/pages/Resume": ["20-saisies", "60-lecteurs", "profils"],
    "frontend/src/pages/Mensuel": ["10-import", "20-saisies", "60-lecteurs", "profils"],
    "frontend/src/pages/Annuel": ["60-lecteurs", "profils"],
    "frontend/src/pages/Individuel": ["40-utilisateurs", "60-lecteurs", "profils"],
    "frontend/src/pages/Graphes": ["70-graphes"],
    "frontend/src/pages/Rapport": ["60-lecteurs", "70-graphes"],
    "frontend/src/pages/admin/saisie/": ["20-saisies", "30-employes"],
    "frontend/src/pages/admin/Saisie": ["20-saisies", "30-employes"],
    "frontend/src/pages/admin/Employes": ["30-employes"],
    "frontend/src/pages/admin/Utilisateurs": ["40-utilisateurs"],
    "frontend/src/pages/admin/Donnees": ["10-import", "50-donnees"],
    "frontend/src/pages/admin/Referentiels": ["50-donnees"],
    "backend/app/imports/": ["10-import"],
    "backend/app/api/imports": ["10-import"],
    "backend/app/api/saisie": ["20-saisies"],
    "backend/app/api/salaries": ["30-employes"],
    "backend/app/api/comptes": ["40-utilisateurs"],
    "backend/app/api/auth": ["40-utilisateurs", "profils"],
    "backend/app/api/donnees": ["50-donnees"],
    "backend/app/api/parametrage": ["50-donnees"],
    "backend/app/repos/remplissage": ["50-donnees"],
    "backend/app/kpi/": ["10-import", "20-saisies", "60-lecteurs", "70-graphes"],
    "frontend/e2e-recette/outils.ts": "*",
}
# Une spec qui lit les données importées par une autre : on lance aussi celle-ci, avant.
PREALABLES = {"50-donnees": ["10-import"]}


def git(*args: str) -> list[str]:
    out = subprocess.run(["git", *args], cwd=RACINE, capture_output=True, text=True, check=True)
    return [ligne for ligne in out.stdout.splitlines() if ligne.strip()]


def fichiers_modifies(depuis: str | None) -> list[str]:
    noms = set(git("diff", "--name-only", "HEAD")) | set(git("ls-files", "--others", "--exclude-standard"))
    if depuis:
        noms |= set(git("diff", "--name-only", f"{depuis}...HEAD"))
    return sorted(noms)


def plan_backend(fichiers: list[str]) -> tuple[list[str] | None, list[str]]:
    """Renvoie (fichiers de test, ou None pour tout ; raisons)."""
    py = [f for f in fichiers if f.startswith("backend/") and (f.endswith((".py", ".ini")) or "requirements" in f)]
    if not py:
        return [], []
    raisons: list[str] = []
    if not CARTE.exists():
        return None, ["carte absente : suite complète (elle sera refaite)"]
    carte: dict[str, list[str]] = json.loads(CARTE.read_text(encoding="utf-8"))
    tests: set[str] = set()
    for f in py:
        if f.startswith(SOCLE_BACK):
            return None, [f"{f} fait partie du socle : suite complète"]
        rel = f.removeprefix("backend/")
        if rel.startswith("tests/"):
            if (BACK / rel).exists() and Path(rel).name.startswith("test_"):
                tests.add(rel)
            continue
        if rel.startswith("alembic/"):
            tests.add("tests/test_migrations.py")
            continue
        if not rel.startswith("app/"):
            continue
        if not (BACK / rel).exists():
            raisons.append(f"{f} supprimé : suite complète")
            return None, raisons
        lies = carte.get(rel)
        if not lies:
            # Nouveau fichier, ou exécuté seulement à l'import : on ne sait pas qui l'utilise.
            return None, [f"{f} inconnu de la carte : suite complète"]
        tests.update(lies)
    # Fichiers de test inconnus de la carte : la carte vieillit, on le signale.
    connus = {t for v in carte.values() for t in v}
    nouveaux = [p.relative_to(BACK).as_posix() for p in (BACK / "tests").glob("test_*.py")]
    if any(t not in connus for t in nouveaux):
        raisons.append("des fichiers de test manquent à la carte : la refaire (--carte) après ce tour")
    return sorted(t for t in tests if (BACK / t).exists()), raisons


def plan_front(fichiers: list[str]) -> tuple[list[str] | None, bool]:
    """Renvoie (fichiers pour vitest related, ou None pour tout ; build nécessaire)."""
    front = [f for f in fichiers if f.startswith("frontend/") and not f.startswith(("frontend/e2e", "frontend/test-results", "frontend/captures"))]
    if not front:
        return [], False
    if any(f.startswith(SOCLE_FRONT) for f in front):
        return None, True
    src = [f.removeprefix("frontend/") for f in front if f.startswith("frontend/src/") and (FRONT / f.removeprefix("frontend/")).exists()]
    return src, True


def plan_recette(fichiers: list[str]) -> list[str] | None:
    specs: set[str] = set()
    for f in fichiers:
        if f.startswith("frontend/e2e-recette/") and f.endswith(".spec.ts"):
            specs.add(Path(f).name.removesuffix(".spec.ts"))
            continue
        for prefixe, cible in RECETTE.items():
            if f.startswith(prefixe):
                if cible == "*":
                    return None
                specs.update(cible)
    for s in list(specs):
        specs.update(PREALABLES.get(s, []))
    return sorted(specs)


def lancer(titre: str, cmd: list[str], cwd: Path, env: dict | None = None) -> bool:
    print(f"\n== {titre} : {' '.join(cmd)}", flush=True)
    r = subprocess.run(
        cmd, cwd=cwd, env={**os.environ, **(env or {})}, shell=(os.name == "nt" and cmd[0] in ("npm", "npx")),
        capture_output=True, text=True, encoding="utf-8", errors="replace", check=False,
    )
    # Sortie courte : le bilan si tout va bien, la fin du journal en cas d'échec.
    lignes = [x for x in (r.stdout + r.stderr).splitlines() if x.strip()]
    print("\n".join(lignes[-(40 if r.returncode else 3):]))
    print(f"== {titre} : {'OK' if r.returncode == 0 else 'ÉCHEC'}", flush=True)
    return r.returncode == 0


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--depuis", help="référence git de départ (ex. main)")
    ap.add_argument("--voir", action="store_true", help="affiche le plan sans lancer")
    ap.add_argument("--carte", action="store_true", help="suite backend complète et carte refaite")
    ap.add_argument("--recette", action="store_true", help="lance aussi la recette ciblée")
    a = ap.parse_args()

    fichiers = fichiers_modifies(a.depuis)
    back, raisons = plan_backend(fichiers)
    if a.carte:
        back, raisons = None, ["--carte demandé"]
    front, build = plan_front(fichiers)
    recette = plan_recette(fichiers)
    py_modifies = [f.removeprefix("backend/") for f in fichiers if f.startswith("backend/") and f.endswith(".py") and (RACINE / f).exists()]

    print(f"{len(fichiers)} fichier(s) modifié(s).")
    print("Backend :", "suite complète" if back is None else (", ".join(back) or "rien"))
    for r in raisons:
        print("  -", r)
    print("Frontend :", "build + suite complète" if front is None else (f"build + vitest related ({len(front)} fichier(s))" if build else "rien"))
    print("Recette :", "complète" if recette is None else (", ".join(recette) or "rien"))
    if a.voir:
        return 0

    ok = True
    if py_modifies:
        ok &= lancer("ruff", [str(PY), "-m", "ruff", "check", "-q", *py_modifies], BACK)
    if back is None:
        ok &= lancer("pytest complet + carte", [str(PY), "-m", "pytest", "-q", "-p", "no:cacheprovider"], BACK, {"CARTE_TESTS": "1"})
    elif back:
        ok &= lancer("pytest ciblé", [str(PY), "-m", "pytest", "-q", "-p", "no:cacheprovider", *back], BACK)
    if build:
        ok &= lancer("build", ["npm", "run", "build", "--silent"], FRONT)
        if front is None:
            ok &= lancer("vitest complet", ["npm", "test", "--silent"], FRONT)
        elif front:
            ok &= lancer("vitest ciblé", ["npx", "vitest", "related", "--run", "--reporter=dot", "--passWithNoTests", *front], FRONT)
    if a.recette and recette != []:
        specs = [] if recette is None else [f"e2e-recette/{s}.spec.ts" for s in recette]
        ok &= lancer("recette", ["npx", "playwright", "test", "-c", "playwright.recette.config.ts", "--reporter=line", *specs], FRONT, {"E2E_BASE": "recette-e2e.db"})
    print("\nRÉSULTAT :", "tout est vert" if ok else "au moins un échec")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
