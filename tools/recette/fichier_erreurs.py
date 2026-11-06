"""Fichiers d'import pour la recette automatique : mêmes données à chaque passage.

Usage (depuis backend/) : .venv/Scripts/python ../tools/recette/fichier_erreurs.py <dossier>
Écrit dans <dossier> :
- juillet_2026_erreurs.xlsx : juillet 2026 avec des erreurs volontaires (bloquantes et avertissements) ;
- aout_2026.xlsx : août 2026 propre (deux départs, un nouvel employé) ;
- aout_2026_revise.xlsx : août 2026 avec quelques montants différents (remplacement du mois) ;
- manifeste.json : employés visés par chaque défaut et nombre de lignes attendues.
Les lignes viennent de juin 2026 de l'historique de recette (aucun écart de contrat, de site ou de service).
"""

import io
import json
import sys
from pathlib import Path

ICI = Path(__file__).resolve().parent
sys.path.insert(0, str(ICI))

import openpyxl
from reinit import _num, historique_recette

# Position (dans l'ordre du fichier) de l'employé visé par chaque défaut de juillet.
POS = {"non_numerique": 2, "site_inconnu": 5, "service_faute": 8, "sans_matricule": 11,
       "doublon": 14, "mois_isole": 17, "mois_faux": 20, "negatif": 23}
NOUVEAU = {"matricule": "NEW901", "nom": "Recrue Recette"}


def _base() -> tuple[list[str], list[list]]:
    contenu, _ = historique_recette((2026, 6))
    ws = openpyxl.load_workbook(io.BytesIO(contenu), data_only=True)["DONNEES"]
    entetes = [ws.cell(3, c).value for c in range(2, 29)]
    col = {h: i for i, h in enumerate(entetes)}
    lignes = [list(r) for r in ws.iter_rows(min_row=4, min_col=2, max_col=28, values_only=True) if r[0]]
    juin = [r for r in lignes if r[col["ANNÉE"]] == 2026 and _num(r[col["MOIS"]]) == 6]
    # Brut Réel aligné sur la somme de ses composantes (Variable = Commission) : seuls les défauts voulus restent à signaler
    for r in juin:
        r[col["Brut Réel"]] = sum(r[col[c]] or 0 for c in ("Salaire brut garantie", "Variable", "Bonus", "Primes sur ventes"))
    return entetes, sorted(juin, key=lambda r: r[col["MATRICULE"]])


def _ecrire(chemin: Path, entetes: list[str], lignes: list[list]) -> None:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "DONNEES"
    ws["B1"] = "FEUILLE DE DONNÉES CENTRALE (recette)"
    for i, h in enumerate(entetes):
        ws.cell(3, i + 2, h)
    for n, r in enumerate(lignes, start=4):
        for i, v in enumerate(r):
            ws.cell(n, i + 2, v)
    wb.save(chemin)


def main(dossier: Path) -> None:
    dossier.mkdir(parents=True, exist_ok=True)
    entetes, juin = _base()
    col = {h: i for i, h in enumerate(entetes)}

    def mois(nom: str) -> list[list]:
        out = [list(r) for r in juin]
        for r in out:
            r[col["MOIS"]] = nom
        return out

    # Juillet avec défauts
    juillet = mois("Juillet")
    cibles = {k: juillet[p][col["MATRICULE"]] for k, p in POS.items()}
    manifeste = {"lignes_base": len(juillet), "cibles": cibles,
                 "noms": {k: juillet[p][col["Noms"]] for k, p in POS.items()},
                 "services": {k: juillet[p][col["Service"]] for k, p in POS.items()}}
    juillet[POS["non_numerique"]][col["Crédit téléphonique"]] = "douze mille"
    juillet[POS["site_inconnu"]][col["Site"]] = "Bonamoussadi"
    juillet[POS["service_faute"]][col["Service"]] = "Pneumatiques"
    juillet[POS["sans_matricule"]][col["MATRICULE"]] = None
    juillet[POS["sans_matricule"]][col["Noms"]] = None
    juillet[POS["mois_isole"]][col["MOIS"]] = "Juin"
    juillet[POS["mois_faux"]][col["MOIS"]] = "Juilet"
    juillet[POS["negatif"]][col["Frais de mission"]] = -2500
    juillet.insert(POS["doublon"] + 1, list(juillet[POS["doublon"]]))
    _ecrire(dossier / "juillet_2026_erreurs.xlsx", entetes, juillet)

    # Août propre : deux départs, un nouvel employé
    aout = mois("Août")
    departs = [aout[3][col["MATRICULE"]], aout[9][col["MATRICULE"]]]
    manifeste["departs_aout"] = departs
    aout = [r for r in aout if r[col["MATRICULE"]] not in departs]
    modele = list(aout[0])
    modele[col["MATRICULE"]], modele[col["Noms"]] = NOUVEAU["matricule"], NOUVEAU["nom"]
    aout.append(modele)
    manifeste["nouveau"] = NOUVEAU
    manifeste["lignes_aout"] = len(aout)
    _ecrire(dossier / "aout_2026.xlsx", entetes, aout)

    # Août révisé : frais de mission différents pour trois employés
    revise = [list(r) for r in aout]
    changes = []
    for p in (0, 4, 6):
        r = revise[p]
        avant = r[col["Frais de mission"]] or 0
        r[col["Frais de mission"]] = avant + 12345
        changes.append({"matricule": r[col["MATRICULE"]], "avant": avant, "apres": avant + 12345})
    manifeste["revisions_aout"] = changes
    _ecrire(dossier / "aout_2026_revise.xlsx", entetes, revise)

    (dossier / "manifeste.json").write_text(json.dumps(manifeste, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Fichiers de recette écrits dans {dossier}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage : fichier_erreurs.py <dossier>")
    main(Path(sys.argv[1]))
