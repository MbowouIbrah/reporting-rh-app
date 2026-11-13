# Étude : import direct de l'export de paie (27c, 13/11)

Source : modèle `BrutFinal1026.CSV` (102 colonnes, séparateur `;`, Latin-1, en-têtes seuls). Réponses du client du 13/11 : activité par le poste (C4), site = « Intitulé établissement » (E8), mois = nom du fichier (E9).

## 1. Besoin

Remplacer la saisie du tableau DONNEES (Excel de l'appli) par le fichier exporté de la paie, tel quel, sans retouche. Les KPI, totaux et règles d'exclusion restent les mêmes.

## 2. Existant

| Élément | Où | Constat |
|---|---|---|
| Lecture | `imports/lecture.py:83` `lire()` | Excel seulement. Le CSV demande une lecture à part (`;`, UTF-8 puis Latin-1). |
| Contrôles | `imports/regles.py:366` `valider()` | Par en-tête reconnu ; colonne en double = problème ; colonne inconnue = avertissement. Réutilisable si le CSV est d'abord ramené aux colonnes de l'appli. |
| Rubriques | `referentiels_init.py:28` | 17 rubriques regroupées (Brut Réel, Charges Patronales…). La paie en a ~90, détaillées. |
| Alias | `RefAlias` (`models/referentiel.py`) | Un nom → une valeur. Ne sait pas additionner plusieurs colonnes. |
| Activité | `situation.activite_id` | Lue dans la colonne « Activité ». Les KPI (front / back office) lisent ce champ. |
| Poste | `Poste` (`models/referentiel.py:50`) | Simple liste, sans activité. |

## 3. Correspondance des colonnes

### a. Employé

| Colonne de paie | Appli | Remarque |
|---|---|---|
| Matricule | Matricule | Obligatoire (E6). |
| Nom + Prénom | Noms | « NOM Prénom ». |
| Emploi occupé | Poste | **Donne l'activité** (C4). |
| Intitulé établissement | Site | Alias si le libellé diffère (« Douala » / « DOUALA »…). |
| Intitulé service | Service | Idem. |
| Intitulé département | Département | Étape E7. |
| Nature du contrat | Type Contrat | Alias (ex. « Contrat à durée indéterminée » → CDI). |
| Date de naissance, Date d'embauche, Civilité, catégorie, unité, codes | — | Non utilisés aujourd'hui : ignorés, sans erreur. |

Présent dans le fichier du mois = actif ce mois-là.

### b. Rubriques (proposition par défaut, modifiable par l'admin)

| Rubrique de l'appli | Colonnes de paie additionnées |
|---|---|
| Brut Réel | BRUT |
| Salaire brut garantie | SALAIRE DE BASE |
| Bonus | BONUS |
| Commission | COMMISSIONS |
| Primes exceptionnelles | PRIME EXCEPTIONNELLE |
| Productivité Ateliers | PRIME SUR RENDEMENT + RAPPEL RENDEMENT |
| Logement site déporté | LOGEMENT DEPLACE |
| Charges Patronales | CNPS PAT + AT PAT + ALLOC FAM + CF PAT + FNE |
| Assurance Maladie | ASS. MALADIE |
| Primes sur ventes, Primes sur résultats | aucune colonne évidente : vide |
| Absences, Frais de mission, Carburant, Crédit téléphonique, Formation, TVA & Marge MAD | pas dans la paie : vide |

Les autres colonnes (retenues, IRPP, NET A PAYER, rappels non cités…) sont ignorées. Les deux colonnes en double (RETENUE CREDIT DIVERS, RETENUE PAGNES SUPPL) sont des retenues : ignorées, donc pas d'erreur de doublon.

Montants additionnés en `Decimal`, sans arrondi (règle du projet). Cellule vide = 0 dans la somme ; toutes vides = pas de montant.

## 4. Options

| Option | Pour | Contre |
|---|---|---|
| A. Une rubrique par colonne de paie (~90) | Rien à décider | Tableaux illisibles, totaux et règles d'exclusion à refaire. |
| B. **Table de correspondance modifiable** (colonne de paie → rubrique, additionnée) | KPI et écrans inchangés ; le client corrige lui-même | Une table et un écran admin. |
| C. Correspondance écrite dans le code | Rapide | Chaque correction demande une livraison. |

**Choix : B.** Le CSV est lu, ramené aux colonnes de l'appli (employé + rubriques additionnées), puis passe par les contrôles actuels (`valider()`), qui restent la seule source de règles.

## 5. Activité par le poste

- `poste.activite_id` (facultatif) : chaque poste est classé Front office ou Back Office dans l'écran des listes de valeurs.
- À l'import, l'activité de la ligne = celle du poste. Le champ `situation.activite_id` reste rempli : aucun calcul KPI ne change.
- Poste inconnu ou non classé : problème à régler (« Ajouter » le poste en choisissant son activité, ou le rattacher à un poste connu). L'import n'est pas bloqué en entier.
- Fichier Excel actuel : la colonne Activité reste lue tant qu'il sert ; si elle est vide, l'activité vient du poste.

## 6. Impacts

- **Base** : migration 0026 : `poste.activite_id` ; table `correspondance_paie` (colonne de paie normalisée, rubrique) remplie avec le § 3b.
- **Écrans** : listes de valeurs (activité du poste) ; nouvel onglet admin « Correspondance de la paie ».
- **Import** : envoi d'un `.csv` accepté ; mois lu dans le nom (`BrutFinalMMAA`), sinon choisi par l'admin.
- **Sécurité** : droits inchangés (admin seulement pour importer et régler la correspondance).
- **Risques** : libellés réels inconnus (modèle vide) : les alias et l'écran de correspondance absorbent les écarts ; rubriques hors paie (§ 3b) vides tant qu'aucune source n'est fixée.

## 7. Décidé par défaut

- Correspondance du § 3b, modifiable par l'admin.
- Rubriques absentes de la paie : l'import Excel actuel reste disponible pour les compléter (il n'est pas masqué tant qu'une autre source n'existe pas).

## 8. Plan

1. Migration 0026 + modèles (`poste.activite_id`, `correspondance_paie`) + données de base.
2. Lecture du CSV → feuille au format de l'appli (sommes, activité par le poste) ; mois dans le nom.
3. Contrôles : poste non classé, colonnes ignorées sans erreur ; tests.
4. API + écrans : activité du poste, correspondance, envoi `.csv`.
5. Vérification : pytest, ruff, build, vitest, recette ciblée import.
