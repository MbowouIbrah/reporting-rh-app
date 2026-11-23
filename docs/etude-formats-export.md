# Étude : graphes exportés en format modifiable (retours N2, point 2)

## Besoin
Récupérer les graphes d'évolution dans un format qu'on peut modifier (titres, couleurs, valeurs) pour les présentations, notamment PowerPoint.

## Existant
- Les graphes sont dessinés à l'écran (Recharts) à partir du rapport annuel, calculé côté serveur avec le périmètre et les droits déjà appliqués.
- Il y a un export PDF (figé) et un export Excel du rapport annuel (openpyxl, déjà en dépendance).

## Options
| Option | Pour | Contre |
|---|---|---|
| Image (PNG/SVG) | Simple | Pas modifiable : il faut refaire le graphe |
| Excel avec vrais graphiques (openpyxl) | Pas de nouvelle dépendance ; graphe lié à ses données ; copié dans PowerPoint, il reste modifiable (« Modifier les données ») | Rendu un peu différent de l'écran |
| PowerPoint (python-pptx) | Directement dans la présentation | Nouvelle dépendance, image Docker à refaire, plus de code |

## Choix
Excel avec vrais graphiques : une feuille par graphe (tableau Mois / N / N-1 / Objectif + graphique lié). Les graphes sans données n'ont pas de feuille. Même filtres et mêmes droits que l'écran (marge réservée = pas de feuille Marge).
Accès : bouton « Graphes modifiables (Excel) » sur la page Graphes ; route `GET /rapports/annuel/export?graphiques=true` (export journalisé `graphes_annuels`).

## Reste
Export PowerPoint direct : noté au backlog, à faire si le copier-coller depuis Excel ne suffit pas.
