# P0 : cadrage de l'application Reporting RH

Statut : validé par le commanditaire (« je valide tout »). Les points marqués **[H]** sont des hypothèses par défaut, paramétrables sans code ; à confirmer avant P8.

## 1. Dictionnaire des KPI

Unité : FCFA sauf mention. Calcul côté serveur sur montants `NUMERIC(18,3)`, arrondi à l'affichage seulement.

| KPI | Définition | Règle « vide / zéro » |
|---|---|---|
| TOTAL CHARGES (ligne) | Somme des rubriques dont `inclus_total_charges` = vrai à la date de la période | Rubrique vide = 0 |
| Rubriques exclues du total (à date d'effet) | Absences (nb), Salaire brut garantie, Primes sur ventes, Primes sur résultats, Productivité Ateliers, Commission (depuis le 16/10, partout) | Modifiable : une règle datée (date d'effet) ; tout changement est tracé au journal d'audit |
| Masse salariale (MS) | Somme des TOTAL CHARGES sur le périmètre filtré et la période | 0 si aucune ligne, affiché « — » |
| VARIATION | M − (M-1) | M-1 absent : « — » |
| VAR % | (M − M-1) / M-1 | M-1 = 0 : « n/a » (l'Excel affichait 0, écart connu documenté) |
| Effectif | Nombre de matricules **distincts** de la période | |
| Effectif début | Effectif de M-1 | M-1 absent : « — » |
| Recrutements | Matricules présents en M et absents de M-1 | |
| Départs | Matricules présents en M-1 et absents de M | |
| Effectif fin | Effectif de M. Contrôle : début + recrutements − départs | Écart signalé |
| Taux de rotation | ((Recrutements + Départs) / 2) / ((début + fin) / 2) | Dénominateur 0 : « n/a » |
| Absences (nb) | Somme de la rubrique Absences (jours) | |
| Taux d'absentéisme | Absences / (Effectif × jours ouvrés) ; jours ouvrés = paramètre, 22 par défaut | Effectif 0 : « n/a » |
| Budget | Budget mensuel par employé (600 000) × effectif, plus budgets saisis par rubrique/service/site | Non saisi : « — » |
| Écart / Budget | M − Budget ; % = écart / budget | |
| Chiffre d'affaires (CA) | Saisi par période (global) | Non saisi : vide |
| Marge | Saisie par période avec le CA (comme dans l'Excel, décision 08c) ; peut être négative, refusée sans CA. Les marges antérieures à 08c (CA × paramètre) ne sont pas reprises : à ressaisir | Non saisie : vide (jamais 0) |
| Taux de marge | Marge / CA | Vide si CA ou marge absent ; CA 0 : « n/a » |
| CA YTD | Cumul sur les mois où un CA est saisi | |
| Marge YTD | Cumul sur les mois où une marge est saisie ; taux YTD = Σ marges / Σ CA de ces mêmes mois | |
| Cumul YTD | Somme janvier → mois sélectionné | |
| Moyenne mensuelle | Cumul / nombre de mois saisis | |
| Nb de mois saisis | Périodes contenant au moins une ligne (obligatoire à côté de tout cumul) | |
| Commissions, Primes | Somme de la rubrique correspondante | |
| Contrôles de cohérence | MS bloc type de charge = MS par service = MS par site ; Total contrats = CDI + CDD + MAD | Tout écart > 0,5 FCFA est bloquant en recette |

Blocs de restitution (mensuel) : A type de charge, B service × activité, C site (MS + effectif), D effectifs × contrat (CDI, CDD, MAD, Total), ventilation contrat × activité. Colonnes : M-1, M, VAR, VAR %, Budget, Écart, %.
Annuel : N / N-1, cumul YTD, moyenne mensuelle, nb de mois saisis, ventilation par service. Individuel : un matricule sur 12 mois. Graphes : masse salariale, effectif, absences, répartition par contrat (4 séries maximum, axe masse salariale non forcé à zéro).

Écart connu : l'Excel additionne le nombre d'absences aux montants FCFA des exclusions (+11 en juin 2026, +78 et +164 dans RESULTAT_ATTENDU.md). L'application est exacte ; l'exception est listée dans `golden/ecarts_connus.yaml`.

## 2. Rôles, périmètres, droits

| Rôle | Qui | Périmètre | Écriture | Détail nominatif |
|---|---|---|---|---|
| `rh_admin` | Administrateur principal (1 personne) | Global | Oui : import, saisie, CA, budgets, référentiels, règles, utilisateurs | Oui |
| `lecteur_global` | DRH, DOP | Global | Non | Oui |
| `lecteur_perimetre` | DOP/DPS Equipment | Périmètre Equipment **[H]** | Non | Non, agrégats seulement **[H]** |
| `lecteur_perimetre` | Directeur commercial VN | Périmètre Commerce VN **[H]** | Non | Non, agrégats seulement **[H]** |

Périmètres (données, éditables dans l'application) :
- **Equipment [H]** : SAV PL, SAV Engins, Pneumatique, Sites Déportés. Administration exclue.
- **Commerce VN [H]** : service Commerce VN seul.

Règles :
- Le filtre de périmètre est appliqué côté serveur (couche dépôt), jamais côté front.
- Tout `POST/PUT/DELETE` d'un lecteur renvoie 403.
- La marge et le taux de marge ne sont visibles que par `rh_admin` et `lecteur_global` **[H]** : le CA est global, il n'existe pas par périmètre.
- Le drapeau `nominatif` est porté par chaque affectation de rôle : l'accorder à un lecteur à périmètre ne demande aucun développement.
- Toute lecture de fiche individuelle est journalisée. Toute écriture produit un `audit_event`.
- Ajouter une personne = une ligne `utilisateur` + une `role_assignment`.

Décision (2026-10-02) : les hypothèses **[H]** ci-dessus (périmètre Equipment, nominatif, marge pour lecteurs à périmètre) sont retenues telles quelles ; la première présentation aux parties prenantes dira ce qu'il faut modifier. Ce sont des données de configuration, pas du code.

## 3. Autres décisions de cadrage
- Plusieurs administrateurs : hors cycle 1 (une seule personne modifie le système).
- Jours ouvrés (22) et budget par employé (600 000) : paramètres datés, modifiables par l'administrateur.
- Template d'import v1 : `templates/TEMPLATE_IMPORT_DONNEES_v1.xlsx`. Contrôle : `outils/valider_import.py` (les mêmes règles seront reprises par l'import du backend).
- Source de vérité de la parité : l'Excel V5 alimenté de données réelles purifiées, pas la V4 test.
- Hébergement **[H]** : ajout d'un `location /reporting-rh/` au nginx d'Academy, accès sur le réseau interne. À confirmer en P1.

## 4. Critère de sortie P0
Document validé (fait) ; `backlog.md` créé ; hypothèses [H] listées pour confirmation avant P8.
