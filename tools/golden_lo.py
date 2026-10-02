# -*- coding: utf-8 -*-
"""Relevé des restitutions par LibreOffice (sans Excel) pour chaque période.

Usage : python golden_lo.py <classeur.xlsx> <periodes.json> <sortie.json> [--controle]
Pour chaque période : copie du classeur avec le sélecteur (MENSUEL!C4 mois, D4 année) modifié par
openpyxl (sans valeurs en cache, donc LibreOffice recalcule tout), conversion headless, lecture des
valeurs. L'original n'est jamais modifié. `--controle` : une seule période, la sélection d'origine.
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from openpyxl import load_workbook

SOFFICE = r"C:\Program Files\LibreOffice\program\soffice.exe"
MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août",
        "Septembre", "Octobre", "Novembre", "Décembre"]
FEUILLES = {"mensuel": "REPORTING_RH_MENSUEL", "annuel": "REPORTING_RH_ANNUEL ", "resume": "RÉSUMÉ"}


def une_periode(classeur: str, annee: int, mois: int, tmp: Path) -> dict:
    wb = load_workbook(classeur)
    ws = wb["REPORTING_RH_MENSUEL"]
    ws["C4"], ws["D4"] = MOIS[mois - 1], annee
    src = tmp / f"p_{annee}_{mois:02d}.xlsx"
    wb.save(src)
    out = tmp / "out"
    out.mkdir(exist_ok=True)
    subprocess.run([SOFFICE, "--headless", "--norestore", f"-env:UserInstallation=file:///{tmp.as_posix()}/profil",
                    "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", str(out), str(src)],
                   check=True, capture_output=True, timeout=600)
    calc = load_workbook(out / src.name, data_only=True)
    return {k: {c.coordinate: c.value for row in calc[nom].iter_rows() for c in row
                if c.value is not None} for k, nom in FEUILLES.items()}


def main() -> None:
    classeur, periodes, sortie = sys.argv[1:4]
    liste = [(2026, 6)] if "--controle" in sys.argv else json.load(open(periodes))
    tmp = Path(tempfile.mkdtemp())
    res = {}
    try:
        for annee, mois in liste:
            res[f"{annee}-{mois:02d}"] = une_periode(classeur, annee, mois, tmp)
            print("ok", annee, mois, flush=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    Path(sortie).write_text(json.dumps(res, ensure_ascii=False, sort_keys=True, default=str),
                            encoding="utf-8")


if __name__ == "__main__":
    main()
