# Étude : année fiscale (demande 2)

## Besoin
- Année fiscale du **1er avril au 31 mars** (ex. 2026-27 = avril 2026 → mars 2027).
- Présenter **les deux** : année civile et année fiscale, au choix dans les filtres.
- Appliquer le choix au rapport annuel, aux cumuls depuis le début de l'année et aux graphiques.
- Q2.1 (budgets par année fiscale ou civile ?) : sans objet, budgets et objectifs sont **mensuels** (voir `etude-objectifs.md`).

## Existant
- Données, budgets, objectifs, paramètres : tous rangés **par mois** (`Periode(annee, mois)`). Rien à migrer.
- `kpi/moteur.annuel` reçoit des dictionnaires `rang -> données` (1 à 12) et un rang de fin de cumul (`mois`). Il ne lit le numéro de mois que pour la série (`serie_n`, `serie_n1`) et `mois_fin`.
- `api/rapports.py` : `_annuel`, `individuel`, `individuel/tous`, `filtres`, `salaries` parcourent `range(1, 13)` de l'année civile.
- Front : filtres partagés (`lib/filtresPartages.ts`, `hooks/useFiltres.ts`, `components/FiltresPeriode.tsx`). Pages annuelles : Résumé, Annuel, Graphiques, Individuel. Libellés « Cumul de janvier à … », colonnes `2026` / `2025`.

## Options
| Option | Pour | Contre |
|---|---|---|
| A. Le serveur compose les 12 mois de l'exercice (rang 1 = avril) et passe des rangs au moteur ; la réponse rend les vrais mois | Moteur inchangé ; un seul endroit pour la règle ; budgets et objectifs relus mois par mois sans changement | Convertir rang ↔ mois réel en entrée et en sortie |
| B. Le moteur reçoit des couples (année, mois) | Plus explicite | Réécrit tout le moteur et ses tests (444) ; risque élevé |
| C. Le front recompose l'exercice à partir de deux années civiles | Pas de changement serveur | Contraire à la règle « calculs KPI côté serveur » ; cumuls et comparaisons faux |

## Choix : option A
- Paramètre d'API `calendrier=civil|fiscal` (défaut `civil`) sur `/rapports/annuel` (+ export), `/individuel`, `/individuel/tous`, `/filtres`, `/salaries`.
- `annee` = année de début de l'exercice (2026 = avril 2026 → mars 2027). `mois` = vrai mois de fin du cumul ; absent = fin de l'exercice.
- Réponse : chaque mois de la série porte son vrai `mois` et son `annee`, dans l'ordre de l'exercice (avril d'abord) ; `mois_fin` = vrai mois, `annee_fin` ajouté.
- Comparaison : l'exercice précédent (ou celui choisi), mêmes rangs (avril N-1 face à avril N).
- Front : choix « Année civile / Année fiscale » dans les filtres des pages annuelles, partagé entre pages (clé `calendrier`, absente = civil). Changer de calendrier remet l'année, le mois et la comparaison par défaut. Libellés : « 2026-27 », « Cumul d'avril 2026 à mars 2027 ».
- Le PDF reprend l'écran, donc suit le choix.

## Décisions prises par défaut
- Page Mensuel : non concernée (un mois reste un mois).
- Bouton « répartir l'annuel » des objectifs : reste sur l'année civile (janvier → décembre, reste sur décembre). À revoir si le client saisit ses objectifs annuels par exercice (noté au backlog).
- Export xlsx (non exposé à l'écran) : libellé de période adapté, rien d'autre.
- Le choix du calendrier est partagé entre les pages annuelles (Annuel, Graphes, Résumé, Individuel) et gardé comme les autres filtres ; la page Mensuel l'ignore.
- L'exercice choisi est partagé sous sa propre clé (`exercice`) ; `annee` reste une année civile pour la page Mensuel. Changer de calendrier ou d'exercice remet seulement la comparaison annuelle à zéro (une année civile et un exercice ne se correspondent pas).
- Revue : laissés tels quels, le court affichage des lignes de l'ancien calendrier pendant le chargement (données précédentes gardées à l'écran) et le choix du calendrier réservé aux pages sans sélecteur de mois.
- Individuel : les lignes de mois affichent le nom du mois seul ; l'ordre (avril → mars) suffit à les situer.

## Impacts
- Données / migrations : aucune. Sécurité : périmètre inchangé (filtre dans la couche dépôt, mêmes appels). Performance : identique (12 mois lus). Déploiement : rien.

## Risques
- Confusion de libellé entre « 2026 » civil et « 2026-27 » fiscal : libellés distincts partout.
- Mois de fin par défaut : en fiscal, dernier mois saisi s'il tombe dans l'exercice, sinon mars.
