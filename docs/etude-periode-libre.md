# Étude : période de toute durée (Résumé et pages annuelles)

## Besoin
Demande du 26/11 : choisir une période de n'importe quelle durée (ex. janv. 2024 → juin 2026), pas seulement 12 mois.

## Existant
- Calendrier : `MAX_MOIS = 12` (`frontend/src/lib/periode.ts`), refus au-delà dans `cliqueMois` et `lireTexte`.
- API : `_plage` (`backend/app/api/rapports.py`) refuse plus de 12 mois (422). La période est rangée dans un « cadre » de 12 rangs : janvier si elle tient dans une année civile, sinon à partir du mois `du`.
- Moteur : `moteur.annuel` travaille sur des rangs ; seules les séries mensuelles et les objectifs mensuels bouclent en dur sur `range(1, 13)`. Le cumul (`debut` → `mois`) est déjà générique.
- `kpi/exercice.py` : `mois_exercice`, `serie_reelle`, `en_mois_reels` supposent 12 mois.
- Exports Excel et graphes : parcourent la série reçue, sans longueur fixe.
- Résumé : le suivi mensuel affiche la série reçue (mois hors période grisés).

## Options
| Option | Pour | Contre |
|---|---|---|
| A. Cadre de longueur variable : 12 rangs si la période fait 12 mois ou moins (inchangé), sinon autant de rangs que de mois, à partir de `du` | Peu de code (paramètre de longueur), aucun changement pour les périodes courtes, séries et exports suivent | Suivi mensuel plus long (défilement, déjà en place) |
| B. Découper en exercices de 12 mois et additionner | Moteur intact | Moyennes d'effectif, taux, objectifs partiels à recombiner : risque d'écarts |

**Choix : A.**

## Décisions
- Durée maximale : 60 mois (5 ans), pour borner le temps de calcul (un chargement par mois, période et comparaison).
- Comparaison par défaut : les mêmes mois décalés d'un nombre entier d'années couvrant la période (12 mois pour ≤ 12 mois, 24 pour 13 à 24 mois, etc.). Les mois restent alignés (janvier contre janvier) et les deux périodes ne se chevauchent pas. Même règle côté calendrier (`defautCmp`).
- Série de comparaison (N-1) du suivi mensuel : même cadre, décalé du même nombre d'années.
- Pages mensuelles (`_mois_comptes`) : même limite de 60 mois.

## Impacts
- Pas de migration. Pas d'effet sur la sécurité (filtre de périmètre inchangé).
- Performance : 60 mois = ~120 chargements ; acceptable sur les volumes actuels, à surveiller.

## Risques
- Effectif « de fin » et moyennes : déjà calculés sur les mois saisis, indépendants de la durée.
