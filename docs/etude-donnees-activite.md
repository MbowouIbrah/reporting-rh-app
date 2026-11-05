# Étude : données d'activité (étape 6, demandes 6 et 10)

Date : 28/10/2026. Branche `donnees-activite`. Source : `docs/DEMANDES_PRESENTATION_3.md` (point bloquant n°1, demandes 6 et 10).

## Besoin
1. **Par employé, dans le fichier mensuel (DONNEES)** : productivité, nombre de ventes, nombre de clients, CA, marge, référence vers le reporting du client.
2. **Globaux, saisis à la main par mois × site × service** : nombre d'OR, de devis, de factures.
3. **Restitution** : des lignes dans les tableaux mensuel et annuel, le détail par employé (Individuel), un indicateur « OR (ou factures) par productif », des graphiques.

## Existant
- Chaque colonne de DONNEES est une `Rubrique` (`unite` FCFA ou jours). Une valeur = une ligne `Montant` (`NUMERIC` exact). L'import (`imports/regles.py`, `imports/service.py`), le modèle Excel (`imports/modeles.py`), l'écran DONNEES (`api/donnees.py`) et les alias suivent la liste des rubriques.
- Les totaux de paie (`kpi/moteur.py`) additionnent toutes les rubriques chargées, sauf celles marquées « exclues ».
- CA et marge du mois : `CaPeriode` (global, un seul chiffre par mois), écran Saisie > Pilotage (`CarteCaMarge.tsx`), lignes `lignes_ca_marge` dans le moteur, masquées sans `marge:read` (`CLES_MARGE`, `api/rapports.py`).
- Le filtre de périmètre (service, site) est appliqué dans la couche dépôt (`repos/scope.py`).

## Options pour les colonnes par employé
| Option | Pour | Contre |
|---|---|---|
| A. Rubriques de **nature « activité »** (nouvelle colonne `rubrique.nature`), unité `nombre` ajoutée | Réutilise tout l'import : reconnaissance des colonnes, alias, contrôles numériques, modèle Excel, écran DONNEES, corrections | Chaque calcul de paie doit écarter la nature « activité » (risque d'oubli → testé) |
| B. Table séparée `activite_mensuelle` | Pas de risque de mélange avec la paie | Il faut refaire la lecture, les contrôles, le modèle et l'affichage de l'import : beaucoup plus de code |

**Choix : A.** Le chargement sépare dès la lecture la paie (`montants`) et l'activité (`activite`). Le moteur de paie ne voit donc jamais les rubriques d'activité, sans avoir à les exclure une par une.

La **référence Annick** est un texte : elle ne rentre pas dans `Montant` (numérique). Elle va dans une colonne texte `situation_mensuelle.reference_activite`, lue à l'import comme le Poste.

## Saisie OR / devis / factures
Nouvelle table `activite_saisie` (période, site, service, indicateur `or`|`devis`|`factures`, valeur `NUMERIC`). Une case vide = pas de ligne. Écran : Saisie > Pilotage du mois, une grille site × service avec 3 valeurs, sur le modèle de la saisie des budgets. Droit : `saisie:write`. Lecture filtrée par périmètre dans la couche dépôt, comme les données de paie.

## Choix par défaut provisoires (questions client ouvertes)
| # | Question | Choix provisoire |
|---|---|---|
| Q0.1 | Que contient « productivité » ? | Un nombre (décimales gardées), pas un montant. Libellé « Indice de productivité » pour ne pas le confondre avec la prime « Productivité Ateliers ». Agrégat : **moyenne** des employés renseignés. |
| Q0.2 | Que contient la référence Annick ? | Un texte libre (200 caractères maximum), affiché dans DONNEES, sans calcul. Libellé « Référence reporting ». |
| Q0.3 | CA par employé ou CA saisi : lequel fait foi ? | Le **CA saisi** reste celui des lignes CA/Marge des tableaux. Le CA et la marge par employé (« CA individuel », « Marge individuelle ») s'affichent seulement dans DONNEES et Individuel, avec `marge:read`. |
| Q0.4 | Forme des fiches individuelles | Sans effet ici : les chiffres arrivent par le fichier mensuel. |
| Q6.1 | Qui est un « productif » ? | Un employé d'un service marqué **productif** (nouveau drapeau `service.productif`, réglable dans Sites, services et colonnes). SAV PL et SAV Engins sont cochés par défaut. |
| — | Qui voit ventes, clients, OR ? | Tous les lecteurs, dans leur périmètre. Seuls CA et marge individuels demandent `marge:read`. |

## Restitution
- **Mensuel et annuel** : un bloc « ACTIVITÉ » sous CA/Marge. Lignes : Nombre de ventes, Nombre de clients, Indice de productivité (moyenne), OR, Devis, Factures, Productifs (effectif), OR par productif, Factures par productif. Les colonnes et la comparaison sont celles des lignes CA/Marge (N, N-1, écart). Le bloc reste masqué tant qu'aucune donnée d'activité n'existe.
- Un ratio dont le diviseur est 0 ou absent s'affiche « — ».
- **Individuel** : lignes Ventes, Clients, Indice de productivité, CA individuel et Marge individuelle (masqués sans `marge:read`).
- **Graphes** : 3 cartes. « OR, devis et factures » (une courbe chacun), « OR et factures par productif », « Ventes et clients ». La 4e carte, « Indice de productivité », vient avec la demande 12 (choix des graphiques). Les objectifs (demande 4) viennent à l'étape 7.
- Exports Excel : mêmes lignes que l'écran.

## Impacts
- **Migration `0016`** : `rubrique.nature` (défaut `paie`), unité `nombre` dans la contrainte, 5 rubriques d'activité, `situation_mensuelle.reference_activite`, `service.productif`, table `activite_saisie`.
- **Import** : les nouvelles colonnes sont facultatives. Un ancien fichier sans ces colonnes s'importe comme avant. Une ligne qui n'a que des chiffres d'activité ne déclenche pas `LIGNE_SANS_MONTANT`.
- **Budgets** : seules les rubriques de paie en FCFA peuvent recevoir un budget.
- **Sécurité** : CA et marge individuels masqués côté serveur (API rapports, DONNEES et exports), jamais côté front.

## Risques
- Une rubrique d'activité qui entrerait dans un total de paie. Parade : séparation dès le chargement, plus un test « total de paie inchangé avec des colonnes d'activité ».
- Les réponses du client aux questions Q0.1 et Q6.1 peuvent changer l'agrégat ou la règle des productifs. Ces points sont isolés : une formule dans le moteur, un drapeau dans la liste des services.

## Points à trancher par le client
Q0.1 à Q0.3, Q6.1, Q10.1. Les choix provisoires ci-dessus restent valables tant que le client n'a pas répondu.
