# Étude : objectifs (demande 4) et frais de mission (demande 11)

Date : 30/10/2026. Branche `budgets-objectifs`.

## 1. Besoin
- Demande 4 : les graphiques et les tableaux montrent l'objectif pour la masse salariale, le CA, les frais de mission, la rémunération globale, la productivité, les commissions, la marge, les ventes, les clients et les factures. Nouveaux graphiques sans objectif : absences, assurance, formation, logement site déporté, crédit téléphonique, carburant.
- Demande 11 : une ligne « Frais de mission » à part dans les tableaux mensuel et annuel, avec son budget.

## 2. Existant
- Toutes les rubriques existent (`referentiels_init.py:30-35`). Frais de mission est compté dans la masse salariale ; Commission est exclue du total.
- Table `budget` (`models/pilotage.py:61`) : budgets par rubrique, service ou site, saisis le même mois. Ils couvrent déjà MS, frais de mission, commissions et rémunération.
- Budget MS de la synthèse = budget par employé × effectif (F2), inchangé.
- `valeur_saisie` + `kpi/niveaux.py` : saisie à plusieurs niveaux (global, site, service, case) pour CA, marge, OR, devis, factures, avec « non réparti », partiel et filtre de périmètre.
- Ventes, clients et productivité : rubriques d'activité par employé (`kpi/moteur.py:18-26`).
- Graphiques (`moteur.py:577`, `Graphes.tsx`) : aucun objectif.

## 3. Options pour les nouveaux objectifs (CA, marge, ventes, clients, factures, productivité)
| Option | Pour | Contre |
|---|---|---|
| **A. Étendre `valeur_saisie`** (groupes `obj_ca_marge`, `obj_activite`) | Niveaux, partiel, périmètre, audit, API et grille déjà là | Colonne `indicateur` à élargir ; productivité en moyenne |
| B. Nouvel axe dans `budget` | Une seule table « budget » | Pas de niveaux : périmètre et partiel à recoder |
| C. Nouvelle table `objectif` | Réel et objectif séparés | Copie du dépôt, de l'API et de la grille |

**Choix : A.** La table `budget` reste telle quelle. La passer à « un seul niveau par mois » (idée du §9.4 de `etude-saisie-granularite.md`) empêcherait d'avoir des budgets par site et par service le même mois, alors que les blocs 2 et 3 affichent les deux.

## 4. Décisions prises par défaut (le client corrige après coup)
- **Q4.1** : les objectifs non monétaires sont saisis par l'administrateur RH, avec la même saisie à plusieurs niveaux. Niveau par défaut : global. Pas de calcul depuis les employés.
- **Q4.2** : un objectif par mois. Bouton « Répartir un objectif annuel » : total ÷ 12, exact à la précision saisie (entier pour les nombres), le reste va sur décembre.
- **Q11.1** : les frais de mission restent dans la masse salariale. Ligne « dont Frais de mission » en plus, sous le total, avec le budget de la rubrique.
- **Q2.1** : objectifs mensuels, donc indépendants de l'année civile ou fiscale.
- Objectif de rémunération = somme des budgets par rubrique (hors absences) : visible au périmètre global sans filtre seulement, comme les budgets par rubrique.
- Objectif de productivité de plusieurs cases : moyenne simple.
- CA et marge (réel et objectif) : réservés au droit `marge:read`.
- Annuel : objectif cumulé sur les mêmes mois que le réel.

## 5. Impacts
- Données : migration `0018` (colonne `indicateur` en `String(20)`, CHECK refait). Aucune donnée déplacée.
- Sécurité : saisie et lecture des objectifs CA/marge sous `marge:read` ; périmètre appliqué dans le dépôt (`chargement.filtrer`).
- Performance : l'annuel charge les budgets des 12 mois.
- Écrans : saisie (2 onglets), tableaux mensuel et annuel, ~19 graphiques, PDF.

## 6. Risques
- Sens de l'écart : positif = mauvais pour un coût, bon pour un résultat (CA, ventes). Couleur inversée pour ces lignes.
- L'objectif de rémunération disparaît avec un filtre, l'objectif MS reste : le dire sous le graphique.
- Un objectif vide ne doit pas rendre le réel « partiel » (test).

## 7. Points pour le client
Aucun bloquant. À signaler : la ligne frais de mission ne change pas le total ; l'objectif de productivité est une moyenne.
