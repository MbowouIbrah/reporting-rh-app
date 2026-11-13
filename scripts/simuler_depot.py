"""Simule le dépôt d'un export de paie dans le dossier surveillé (essais en local).

Usage :
    python scripts/simuler_depot.py --mois 1026 [--dossier ./import] [--source export.csv]

Sans --source, un petit CSV de test est généré (latin-1, séparateur « ; »).
Le fichier est écrit sous un nom temporaire puis renommé, comme le ferait un dépôt complet.
"""

import argparse
import os
import re
import shutil
import sys
from pathlib import Path

ENTETE = ["Matricule", "Nom", "Prénom", "Intitulé établissement", "Nature du contrat", "Emploi occupé",
          "Intitulé service", "Intitulé département", "SALAIRE DE BASE", "BRUT", "CNPS PAT", "AT PAT",
          "BONUS", "RETENUE CREDIT DIVERS", "NET A PAYER"]
EMPLOYES = [
    ["E001", "DUPONT", "Léa", "Douala", "CDI", "Conseiller", "SAV PL", "Atelier",
     "100 000", "150 000,50", "1000", "", "", "5", "120000"],
    ["E002", "NGONO", "Paul", "Yaoundé", "CDD", "Mécanicien", "Atelier", "Atelier",
     "90 000", "130 000", "900", "", "10 000", "", "105000"],
    ["E003", "TCHAMBA", "Aïcha", "Douala", "CDI", "Comptable", "Finance", "Administration",
     "200 000", "260 000", "2000", "", "", "", "210000"],
]


def contenu_test() -> bytes:
    lignes = [ENTETE, *EMPLOYES]
    return ("\r\n".join(";".join(cellules) for cellules in lignes) + "\r\n").encode("latin-1")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--mois", required=True, help="mois et année sur 4 chiffres MMAA (ex. 1026)")
    p.add_argument("--dossier", default=os.environ.get("IMPORT_DIR", "./import"),
                   help="dossier surveillé (défaut : IMPORT_DIR, sinon ./import)")
    p.add_argument("--source", help="CSV à copier ; sinon un CSV de test est généré")
    a = p.parse_args()

    m = re.fullmatch(r"(\d{2})(\d{2})", a.mois)
    if not m or not 1 <= int(m.group(1)) <= 12:
        print("Mois invalide : attendu MMAA, de 0126 à 1226.", file=sys.stderr)
        return 2
    cible_dir = Path(a.dossier)
    cible_dir.mkdir(parents=True, exist_ok=True)
    cible = cible_dir / f"BrutFinal{a.mois}.csv"
    tmp = cible_dir / f".{cible.name}.tmp"
    if a.source:
        source = Path(a.source)
        if not source.is_file():
            print(f"Fichier source introuvable : {source}", file=sys.stderr)
            return 2
        shutil.copyfile(source, tmp)
    else:
        tmp.write_bytes(contenu_test())
    os.replace(tmp, cible)
    print(f"Déposé : {cible}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
