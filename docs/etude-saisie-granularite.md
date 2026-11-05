# Étude : saisir une donnée à plusieurs niveaux (étape 6.3)

Date : 28/10/2026. Branche `donnees-activite`. Demande du 28/10 : chaque donnée saisie à la main (CA, marge, budget, OR, devis, factures…) doit pouvoir se saisir, pour un mois, au niveau employé, service, site ou global. Si le niveau fin existe, le niveau au-dessus se calcule seul. Sinon on saisit au niveau connu : on n'est jamais bloqué par un manque d'information.

## 1. Existant

| Donnée | Où elle est saisie | Niveau aujourd'hui | Stockage |
|---|---|---|---|
| CA, marge | Saisie > Pilotage, carte « Chiffre d'affaires et marge » | Global seulement | `ca_periode` (1 ligne par mois) |
| Budgets | Saisie > Pilotage > Budgets | 3 axes indépendants : rubrique, service, site | `budget` (axe, cible_id) |
| Budget masse salariale | Paramètre | 600 000 × effectif | `parametre` |
| OR, devis, factures | API faite en 6.2, pas d'écran | Site × service | `activite_saisie` |
| Ventes, clients, productivité, CA et marge individuels | Import DONNEES ou grille de saisie | Employé | `montant` (rubriques de nature activité) |

Règles en place qui comptent ici :
- Rapport filtré par site ou service : CA et marge masqués, car ils n'existent qu'au global (Q3 confirmé, `kpi/chargement.py:273`).
- CA et marge visibles seulement avec `marge:read` (D5). Filtre de périmètre dans la couche dépôt.
- Montants exacts (`NUMERIC`, jamais d'arrondi).

## 2. Les niveaux

Un employé appartient chaque mois à un site et à un service. Le niveau le plus fin sous l'employé est donc la **case site × service**. Au-dessus : le site (somme de ses services), le service (somme de ses sites), puis le global.

```
employé ─▶ case site × service ─┬─▶ site ────┬─▶ global
                                └─▶ service ─┘
```

Comment chaque donnée remonte :
- CA, marge, OR, devis, factures, ventes, clients, budgets : **somme**.
- Indice de productivité : **moyenne** (pas de somme, pas de saisie au-dessus de l'employé).
- Taux de marge, ratios « par productif » : toujours **calculés**, jamais saisis.
- Référence reporting : texte, ne remonte pas.

## 3. Options

### Modèle de données

| Option | Pour | Contre |
|---|---|---|
| A. Ajouter site/service à chaque table (`ca_periode`, `budget`, `activite_saisie`) | Peu de migration | Trois fois la même logique de niveaux, d'écran et de calcul |
| **B. Une table unique `valeur_saisie`** (mois, indicateur, site ?, service ?, valeur) | Une seule règle de calcul, un seul écran, un seul contrôle de périmètre ; prête pour les objectifs (demande 4) | Migration de `ca_periode` et `activite_saisie` ; index d'unicité avec des colonnes vides à écrire avec soin |
| C. Saisie toujours au niveau le plus fin | Aucun conflit | Bloque dès qu'un détail manque : contraire à la demande |

Le niveau se lit dans les colonnes remplies : aucune = global ; site seul = site ; service seul = service ; les deux = case. Le niveau employé n'est **pas** dans cette table : il reste dans DONNEES (import ou grille), pour ne pas saisir deux fois la même chose.

### Quand deux niveaux existent

| Option | Pour | Contre |
|---|---|---|
| R1. Le calcul remplace toujours la saisie du dessus | Simple, une seule vérité | Faux dès que le détail est incomplet. Exemple : seuls les commerciaux ont un CA individuel, mais le CA de l'atelier existe aussi. Le global tomberait au CA des commerciaux |
| **R2. Une case vide se calcule ; une case saisie fait foi.** L'écart s'affiche en « non réparti » | Jamais bloqué, jamais faux sans le voir | Une ligne de plus à lire, mais seulement dans l'écran de saisie |

> **Remplacé le 04/11 pour le CA et la marge** : quand la case saisie et la somme des employés existent toutes les deux, la plus récente est retenue et le conflit s'affiche (voir `docs/inventaire-donnees-saisies.md`, X1). R2 reste valable pour les autres données.

Exemple R2 : CA global saisi 100, CA du site A saisi 40, autres sites vides → global 100, « non réparti » 60. Si le détail dépasse le total saisi, alerte orange (comme les points d'attention actuels).

### Site ou service : un seul niveau par mois et par donnée

Un site et un service se croisent. Si l'on saisit le CA par site **et** par service le même mois, le global n'a pas de sens clair. Règle : pour un mois, une donnée a **un niveau de saisie** au choix : Global, Par site, Par service, Par site et service. Au-dessus, les cases sont calculées (lecture seule). Les données employé (DONNEES) remplissent d'office les cases vides du niveau choisi.

## 4. Choix recommandé

- **Modèle B + règle R2 + un niveau de saisie par mois et par donnée.**
- CA et marge partagent le même niveau (le taux de marge doit se calculer case par case). OR, devis, factures partagent aussi le leur (même grille qu'en 6.2).
- Niveau par défaut : celui des données existantes (CA, marge : global ; OR, devis, factures : site et service). Si des CA individuels existent et rien n'est saisi : site et service, cases calculées depuis les employés.
- Changer de niveau quand des chiffres existent : on demande confirmation. Vers plus large, la somme du détail est proposée comme valeur. Vers plus fin, l'ancien total reste affiché « à répartir ».
- Un total dont des cases manquent est marqué « partiel (3 sites sur 5) ».

## 5. Écran (Saisie > Pilotage du mois)

Remplace la carte « Chiffre d'affaires et marge ». Un seul écran, sans surcharge :

```
Données du mois — octobre 2026
[ CA et marge ]  [ OR, devis, factures ]  [ Budgets ]          ← onglets

Saisir :  ( Global )  ( Par site )  (•Par service )  ( Par site et service )

                     CA            Marge      Taux
Commerce VN        12 400 000    1 860 000   15,0 %
SAV PL              8 100 000    (calculé)            ← gris : vient des employés
SAV Engins          ________     ________
─────────────────────────────────────────────────
Total (partiel)    20 500 000    1 860 000            ← lecture seule
                                         [ Enregistrer ]
```

- Cases calculées en gris, avec une info-bulle « somme des employés ». Taper une valeur la remplace (R2).
- Le niveau Employé ne se saisit pas ici : un lien « Détail par employé » mène à DONNEES.
- Mêmes composants que la saisie des budgets (`SaisieBudgets.tsx`) : tableau carré, totaux en `tr.total`, pas de filtre ni tri.

## 6. Impacts

- **Migration 0017** : table `valeur_saisie` (`periode_id`, `indicateur`, `site_id` null, `service_id` null, `valeur` montant exact, auteur, date). Unicité par index sur `COALESCE(site_id, 0), COALESCE(service_id, 0)` (marche en PostgreSQL et SQLite). Reprise de `ca_periode` et `activite_saisie`, puis suppression des deux tables.
- **Calcul** : une fonction pure `resoudre(indicateur, niveau, saisies, employes)` qui rend chaque case (valeur, saisi ou calculé, partiel), testée à part. Le moteur l'appelle pour CA, marge et activité.
- **Rapports** : Mensuel et Annuel filtrés par site ou service affichent enfin CA et marge quand le niveau le permet (fin du masquage Q3 dans ce cas). Les tableaux par site et par service peuvent porter CA et marge (demandé dans le reporting commerciaux).
- **Sécurité** : CA et marge toujours derrière `marge:read`, coupés côté serveur. Saisie : `saisie:write`. Une case hors périmètre n'est ni lue ni écrite (403), filtre dans la couche dépôt.
- **API** : `GET/PUT /pilotage/saisies?indicateur=…` remplace la route CA et la route activité de 6.2 (pas encore utilisées par l'écran).
- **Audit** : une entrée par enregistrement, avec niveau et valeurs.

## 7. Risques

- Double compte si un CA individuel et un CA saisi couvrent la même case. Parade : R2, la saisie remplace le calcul case par case, jamais les deux additionnés.
- Migration des données réelles : tester sur une copie de recette.db, puis sur PostgreSQL.
- Budgets : le budget de masse salariale par service et par site coexiste aujourd'hui. Le passer à « un seul niveau » change la règle F2 : à traiter avec la demande 4 (étape 7), pas maintenant.

## 8. Découpage proposé

1. Serveur : table, migration, fonction de calcul, API, tests.
2. Moteur et rapports : CA et marge par site et par service, mention « partiel », périmètre ; exports.
3. Écran : onglets, choix du niveau, grille, cases calculées ; drapeau « productif » dans Sites, services et colonnes (Vitest).
4. Étape 7 : budgets et objectifs dans la même table.

## 9. Points à trancher par l'utilisateur

1. **Quand un total et son détail sont tous deux saisis** : le total saisi fait foi et l'écart s'affiche en « non réparti » (recommandé), ou le calcul remplace toujours le total ?
2. **CA individuel (DONNEES)** : doit-il remonter dans le CA des rapports quand rien n'est saisi au-dessus ? Recommandé : oui. Cela remplace le choix provisoire Q0.3 (« seul le CA saisi fait foi »).
3. **Directeurs à périmètre** : avec un CA par site ou par service, voient-ils le CA de leur périmètre ? Recommandé : non, CA et marge restent réservés à `marge:read` (D5).
4. **Budgets** : même mécanique à l'étape 7, avec les objectifs (recommandé), ou dès maintenant ? *Fait à l'étape 7 : les objectifs (groupes `obj_ca_marge` et `obj_activite`) utilisent la même table et les mêmes niveaux ; les budgets de charges restent dans la table `budget`.*
5. **Ventes et clients** : saisie possible au-dessus de l'employé (par site, par service) ? Recommandé : pas maintenant, ils viennent du fichier mensuel.

## 10. Mise en œuvre (étapes 6.4 et 6.5)

- Points du §9 validés le 28/10 : 1 « non réparti », 2 oui, 3 non, 4 étape 7, 5 pas maintenant.
- **Changement de niveau** : `GET /pilotage/saisies?niveau=` rend la grille d'un autre niveau sans rien enregistrer. `niveau` = niveau affiché, `niveau_enregistre` = niveau en base. Si l'ancien niveau est plus fin, chaque case porte `propose` (somme du détail) et la grille est pré-remplie. Sinon, l'ancien total s'affiche « à répartir » (`a_repartir`) au-dessus de la grille.
- **Niveau par défaut** : celui du dernier mois saisi, sinon celui du §4.
- **Taux de marge** : calculé case par case par le serveur (`taux_marge`). Il est recalculé à l'écran seulement pour une ligne modifiée, en aperçu.
- **Totaux d'activité de la fiche individuelle** : renvoyés par le serveur (`activite_total`). La productivité est une moyenne des mois renseignés, le reste est additionné.
- **Montants à l'écran** : additions exactes, sans arrondi ni nombre à virgule flottante. La validation est la même qu'au serveur : 15 chiffres, 12 décimales au plus, signe accepté pour la marge.
- **Ergonomie** :
  - un bloc copié d'Excel se colle depuis une case ;
  - Entrée descend d'une case, les flèches et Tab se déplacent comme dans un tableur ;
  - les espaces de milliers s'affichent en sortant de la case ;
  - une erreur s'affiche sur la case concernée ;
  - la barre Enregistrer reste visible en bas, et Ctrl+S enregistre ;
  - une saisie en cours n'est jamais effacée par un rechargement, et une alerte prévient en quittant l'écran avec des modifications non enregistrées.
