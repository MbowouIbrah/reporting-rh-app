# Étude : filtres sur la personne, affichage par compte, comparaison de deux sélections (R4, R5, R9 du 23/11)

Source : `docs/retours/RETOURS_REUNION_23_11.md`. Ces trois points touchent toutes les pages de rapport (Budget réalisé, Répartition des charges, Individuel, Graphiques). Maquette : `docs/maquettes/filtres-communs/index.html`.

## 1. Besoin

| # | Demande | Pages |
|---|---|---|
| R4 | Filtrer par sexe, statut, tranche d'âge, ancienneté… selon les colonnes du journal de paie. | Toutes |
| R5 | Chaque compte choisit les indicateurs qu'il voit (ex. masquer âge, sexe, frais de mission) pour alléger l'écran. | Budget réalisé, Répartition des charges |
| R9 | Sur un filtre, choisir « cumul » (aujourd'hui) ou « comparaison » (ex. Equipment contre Winpart, front office contre back office). Une seule comparaison en première version. | Budget réalisé, Répartition des charges, Graphiques |

Contraintes du projet : calculs côté serveur ; filtre de périmètre dans la couche dépôt ; montants exacts ; un compte ne voit que son périmètre.

## 2. Existant

| Élément | Où | Constat |
|---|---|---|
| Barre de filtres commune | `frontend/src/components/FiltresPeriode.tsx:211` | Période, Comparer à, Département, Service, Site, Type de site, Activité, Contrat (+ Poste, Employé sur certaines pages). Déjà 8 à 10 listes : la barre est pleine. |
| Listes à choix multiples | `MultiChoix.tsx` | Réutilisable tel quel pour les nouveaux filtres. |
| Filtres côté serveur | `backend/app/api/rapports.py:226` (`crit`), `ch.filtrer` | Filtre sur la situation du mois (service, site, activité, contrat, poste, employé). Un nouveau critère s'ajoute au même endroit. |
| Employé | `models/donnees.py:59` `Salarie` | Matricule, nom, poste, service, site, activité, contrat. **Ni civilité, ni date de naissance, ni date d'embauche, ni catégorie.** |
| Situation du mois | `models/donnees.py:77` | Service, site, activité, contrat, poste : ce qui peut changer d'un mois à l'autre. |
| Import de la paie | `imports/paie.py:18` `SOURCES` | Lit Matricule, Nom, Prénom, Emploi, Nature du contrat, Établissement, Service, Département. D'après `etude-import-paie.md` §3a, Civilité, Date de naissance, Date d'embauche, Catégorie et Unité sont dans le fichier mais **ignorées**. Le modèle `BrutFinal1026.CSV` n'est pas dans le dépôt : noms exacts à confirmer (Q1). |
| Préférences par compte | `PreferenceUtilisateur` (`models/auth.py:110`), `lib/preference.ts` | Clé + valeur JSON, gardée sur le serveur, suivie sur tous les postes. Déjà utilisée pour les groupes de graphiques. |
| Fenêtre « Personnaliser » | `PersonnaliserGroupes.tsx` | Modèle d'interaction connu des utilisateurs (copie, Enregistrer / Annuler). |
| Comparaison | Pages annuelles (`/rapports/annuel`, `cmp_du`, `cmp_au`) | Compare deux **périodes** avec les mêmes filtres. Pas de comparaison de deux **sélections**. |

« Statut » de la réunion = Type de contrat (CDI, CDD, MAD…), déjà filtrable. La catégorie (cadre, agent de maîtrise, employé…) est une autre notion : on l'ajoute aussi.

## 3. R4 : filtres sur la personne

### Données

| Filtre | Source (paie) | Stockage | Calcul |
|---|---|---|---|
| Sexe | Civilité (M., Mme, Mlle) | `salarie.civilite` (H / F) | Mme et Mlle → F, M. → H. |
| Tranche d'âge | Date de naissance | `salarie.date_naissance` | Âge au dernier jour du mois de la situation (une personne change de tranche au fil de la période). |
| Ancienneté | Date d'embauche | `salarie.date_embauche` | Même règle, au dernier jour du mois. |
| Catégorie | Catégorie | `situation_mensuelle.categorie_id` (+ liste de valeurs `categorie`) | Peut changer (promotion) : gardée au mois, comme le poste. |

Tranches par défaut (fixes en première version, modifiables plus tard dans le paramétrage) :
- Âge : moins de 25 ans, 25-34, 35-44, 45-54, 55 ans et plus.
- Ancienneté : moins d'1 an, 1-3 ans, 3-5 ans, 5-10 ans, 10 ans et plus.

Une donnée absente (fichier sans la colonne, cellule vide) donne la valeur « Non renseigné », filtrable comme les autres : rien n'est perdu ni deviné.

### Options d'intégration

| Option | Pour | Contre |
|---|---|---|
| A. Ajouter les 4 listes à la barre actuelle | Simple | Barre déjà pleine (8-10 listes), illisible sur portable |
| **B. Barre actuelle + bouton « Plus de filtres » qui déplie une 2e ligne « Personne » (Sexe, Âge, Ancienneté, Catégorie)** | Barre principale inchangée ; filtres actifs comptés sur le bouton (« Plus de filtres · 2 ») ; même composant sur toutes les pages | Un clic de plus |
| C. Panneau latéral de filtres | Place illimitée | Change toute la mise en page, rupture avec l'existant |

**Choix : B.** La 2e ligne reste dépliée tant qu'un de ses filtres est actif, pour qu'on voie toujours ce qui filtre.

### Confidentialité

Croiser sexe, âge et site peut isoler une personne et révéler sa paie. Règle proposée : pour un compte **sans** droit `nominatif:read`, une sélection de moins de 3 personnes affiche « Sélection trop petite (moins de 3 personnes) » au lieu des montants. Seuil appliqué côté serveur. Les comptes avec `nominatif:read` voient tout (ils voient déjà les fiches individuelles).

### Impacts

- Migration : 3 colonnes sur `salarie`, table `categorie`, `situation_mensuelle.categorie_id`. Aucune donnée existante perdue ; les mois déjà importés restent « Non renseigné » jusqu'à réimport.
- Import : lire les 4 colonnes en plus (facultatives : un fichier sans elles passe, avec un avertissement). Dates au format `JJ/MM/AAAA` ; date illisible = problème à corriger, comme une autre cellule.
- Export Excel « Données » : 4 colonnes en plus.
- Données de test (`tools/recette/fichiers_paie.py`, données fictives) : à compléter.
- Performance : un critère de plus dans `ch.filtrer`, même coût que les filtres actuels.

## 4. R5 : indicateurs affichés par compte

| Option | Pour | Contre |
|---|---|---|
| **A. Chaque utilisateur choisit lui-même (bouton « Affichage » sur la page)** | Demande telle qu'exprimée ; réutilise `PreferenceUtilisateur` et le modèle « Personnaliser » | Un réglage par page |
| B. L'administrateur choisit pour chaque compte | Écrans homogènes par profil | Charge pour l'admin ; l'utilisateur ne peut pas alléger lui-même |

**Choix : A**, un réglage par page (`affichage.resume`, `affichage.charges`) :
- Budget réalisé : cases KPI cochables (CA, Commissions, Masse salariale, Part des MAD, Marge, Primes, Effectif, CA par salarié) et sections (tableau mensuel, front / back office).
- Répartition des charges : rubriques et familles cochables (ex. masquer Frais de mission).
- Filtres : chaque filtre de la ligne « Personne » est cochable (ex. masquer Sexe et Âge).
- « Rétablir l'affichage d'origine » ; par défaut tout est affiché.

Masquer n'est **pas** un droit : les totaux restent calculés sur tout, l'export garde tout. Les droits (`marge:read`, `nominatif:read`) restent la seule protection. Un indicateur masqué est rappelé discrètement (« 2 indicateurs masqués · Affichage ») pour ne pas faire croire qu'il manque une donnée.

## 5. R9 : cumul ou comparaison de deux sélections

Aujourd'hui, choisir Equipment et Winpart **additionne** les deux (cumul). La demande : les mettre côte à côte.

| Option | Pour | Contre |
|---|---|---|
| A. Deux barres de filtres complètes (sélection A, sélection B) | Totalement libre | Lourd, déroutant ; dépasse « une seule comparaison » |
| B. Bascule « Une autre sélection » dans « Comparer à » + 2e ligne (filtre, A, B) | Lisible | Prend une ligne de plus : **refusé par l'utilisateur (manque de place)** |
| **C. Mode « Cumuler / Comparer » en haut de chaque liste de filtre (comme le menu de filtre d'Excel)** | Aucune place en plus dans la barre ; le geste reste dans la liste qu'on utilise déjà | Plusieurs comparaisons possibles : réglé en grisant « Comparer » dans les autres listes |

**Choix : C** (demande de l'utilisateur, 26/11). Chaque liste à choix multiples s'ouvre sur deux boutons : « Cumuler » (aujourd'hui : valeurs additionnées, par défaut) et « Comparer » :
- En « Comparer », on coche 2 valeurs : la 1re est A, la 2e est B (repères A / B dans la liste) ; les autres cases sont grisées. Le bouton affiche « ⇄ Equipment / Winpart ».
- Une seule comparaison à la fois : « Comparer » est grisé dans les autres listes. Revenir à « Cumuler » ou « Effacer » arrête la comparaison.
- Tant que 2 valeurs ne sont pas cochées, la comparaison de période reste active et le rappel indique « cochez 2 valeurs ».
- « Comparer à » affiche « Sélection B : Winpart » (grisé) pendant la comparaison.
- Même période pour A et B ; les autres filtres s'appliquent aux deux.
- Budget réalisé : chaque case montre A et l'écart avec B ; la colonne « comparaison » du tableau mensuel devient B ; la carte de détail montre A et B.
- Répartition des charges : colonnes « · Equipment » et « · Winpart » au lieu de « · période » / « · comparaison » (lien avec R7).
- Graphiques : deux courbes ou deux barres, A en bleu marine, B en gris pointillé (même code que la comparaison actuelle).
- Vert / rouge : sans objet entre deux sélections (Equipment n'est ni « mieux » ni « moins bien » que Winpart) : écart affiché en neutre.

Serveur : `/rapports/annuel` reçoit en plus `cmp_dim` et `cmp_val` ; il calcule B avec les filtres de A où la dimension comparée est remplacée par `cmp_val`. Périmètre : B passe par le même filtre de dépôt que A (une valeur hors périmètre ne renvoie rien). Le seuil de 3 personnes s'applique à A et à B.

## 6. Risques

- Colonnes absentes ou nommées autrement dans le vrai fichier (Q1) : sans elles, les filtres de R4 n'affichent que « Non renseigné ». Le reste (R5, R9) ne dépend pas de la réponse.
- Charge de calcul doublée en mode comparaison (deux calculs) : acceptable, même ordre que la comparaison de périodes actuelle.
- Écran surchargé : compensé par R5 et la ligne « Personne » repliée.

## 7. Points à trancher

| # | Point | Qui | Défaut appliqué |
|---|---|---|---|
| Q1 | Noms exacts et format des colonnes Civilité, Date de naissance, Date d'embauche, Catégorie dans l'export de paie ; un extrait anonymisé de 2-3 lignes | Client | Noms de `etude-import-paie.md`, dates `JJ/MM/AAAA` |
| Q2 | Tranches d'âge et d'ancienneté | Client | Celles du §3 |
| Q3 | Seuil de confidentialité (3 personnes) | Client | 3, sauf `nominatif:read` |
| Q4 | Affichage choisi par l'utilisateur (et non par l'admin) | Décidé | Option A du §4 |
| Q5 | Comparaison : une dimension, deux valeurs, choisie dans la liste du filtre | Décidé (réunion + utilisateur 26/11) | Option C du §5 |

## 8. Découpage proposé

1. R5 (affichage par compte) : indépendant des données, livrable d'abord.
2. R9 (comparaison de deux sélections) sur les dimensions existantes : Budget réalisé, puis Répartition des charges, puis Graphiques.
3. R4 après la réponse Q1 : migration, import, filtres « Personne », seuil de confidentialité ; R9 s'étend alors à Sexe, Âge, Ancienneté, Catégorie sans autre travail.
