# -*- coding: utf-8 -*-
"""Relève par Excel (COM) des restitutions MENSUEL / ANNUEL / RÉSUMÉ pour chaque période.

Usage (Python avec pywin32) :
  python golden_excel.py <classeur.xlsx> <periodes.json> <sortie.json>
Le classeur est copié dans un dossier temporaire : l'original n'est jamais ouvert ni modifié.
Sélecteur : REPORTING_RH_MENSUEL!C4 (mois en toutes lettres) et D4 (année).
"""
import json
import os
import shutil
import sys
import tempfile

import win32com.client as win32

MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août",
        "Septembre", "Octobre", "Novembre", "Décembre"]
FEUILLES = {"mensuel": ("REPORTING_RH_MENSUEL", "B1:V115"),
            "annuel": ("REPORTING_RH_ANNUEL ", "A1:U148"),
            "resume": ("RÉSUMÉ", "B1:N32")}


def adresse(r0: int, c0: int, i: int, j: int) -> str:
    n, col = r0 + 0, ""
    c = c0 + j
    while c:
        c, rem = divmod(c - 1, 26)
        col = chr(65 + rem) + col
    return f"{col}{n + i}"


def releve(ws, plage: str) -> dict:
    rng = ws.Range(plage)
    r0, c0 = rng.Row, rng.Column
    out = {}
    for i, ligne in enumerate(rng.Value2):
        for j, v in enumerate(ligne):
            if v is not None:
                out[adresse(r0, c0, i, j)] = v
    return out


def main(classeur: str, periodes: str, sortie: str) -> None:
    tmp = tempfile.mkdtemp()
    copie = os.path.join(tmp, "copie.xlsx")
    shutil.copy2(classeur, copie)
    excel = win32.DispatchEx("Excel.Application")
    excel.Visible = False
    excel.DisplayAlerts = False
    excel.EnableEvents = False
    resultat = {}
    wb = None
    try:
        wb = excel.Workbooks.Open(copie, 0, True)  # lecture seule
        sel = wb.Worksheets("REPORTING_RH_MENSUEL")
        for annee, mois in json.load(open(periodes)):
            sel.Range("C4").Value = MOIS[mois - 1]
            sel.Range("D4").Value = annee
            excel.Calculate()
            excel.CalculateFull()
            resultat[f"{annee}-{mois:02d}"] = {
                k: releve(wb.Worksheets(nom), plage) for k, (nom, plage) in FEUILLES.items()}
            print("ok", annee, mois, flush=True)
    finally:
        if wb is not None:
            wb.Close(False)
        excel.Quit()
        shutil.rmtree(tmp, ignore_errors=True)
    with open(sortie, "w", encoding="utf-8") as f:
        json.dump(resultat, f, ensure_ascii=False, indent=0, sort_keys=True)


if __name__ == "__main__":
    main(*sys.argv[1:4])
