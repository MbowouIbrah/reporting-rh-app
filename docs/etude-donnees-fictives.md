# Étude : base de recette 100 % fictive

Décidée le 2026-11-06.

## Besoin
Repartir de données entièrement fictives, sur trois années civiles, couvrant tous les cas de paie. Plus aucun fichier réel nécessaire pour construire la recette.

## Existant
`reinit.py` lisait un fichier d'import réel (18 mois, non suivi), puis ajoutait des scénarios et l'activité fictive (`activite_fictive.py`).

## Options
| Option | Pour | Contre |
|---|---|---|
| Anonymiser le fichier réel | Distributions réalistes | Le fichier réel reste requis ; risque de fuite |
| Générateur à graine fixe (`donnees_fictives.py`) | Aucune donnée réelle ; mêmes lignes à chaque passage ; période libre | Montants moins « réels » |

## Choix
Générateur à graine fixe : 98 salariés (EMP001-EMP098) sur 7 services, plus stagiaires, de janvier 2024 au dernier mois clos (`--fin`). Cas couverts : entrées, sorties, pause, mutation de service (EMP015 Commerce VN → SAV PL en janvier 2026, attendu par la recette), de site, de contrat (CDD/MAD/stage → CDI), de poste et d'office, stagiaire sans paie, régularisation négative, absences, primes saisonnières, hausse annuelle. Brut Réel = somme des composantes (aucun avertissement d'écart).
CA et marge, objectifs (2024-2026) et budgets s'arrêtent à `--fin`. La recette Playwright utilise `--fin 2026-06` : juillet et août restent pour l'import en direct.

## Risques
- Aucun événement après juin 2026 : la recette garde des données stables.
- Les comptes aux vraies adresses restent dans `comptes.local.csv` (non suivi), jamais dans le dépôt.
