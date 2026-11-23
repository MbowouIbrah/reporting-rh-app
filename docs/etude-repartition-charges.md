# Étude : page « Répartition des charges » (R10 à R13, lot L5)

Suite de `docs/etude-retours-reunion-17-11.md` § R10 à R13 (variante B : détail sous les cartes ; puis, décision utilisateur du 18/11, personnes dépliées sous la ligne au lieu du tiroir latéral). Remplace R10 à R13 là où ils diffèrent (liste en § 4). Maquette unique : `docs/maquettes/reunion-17-11/charges.html` (versions v4 à v7 fondues en une seule le 23/11 ; les mentions de versions plus bas sont historiques).

## 1. Besoin
- R10 : une seule page remplace Mensuel et Annuel ; la période de la barre de filtres (calendrier compact, 28-k) décide du mois, du cumul ou de l'année.
- R11 : la page ouvre sur des cartes, une par type de charge, plus le total.
- R12 : clic sur une carte : tableau détaillé (N-1, N, variation, variation %) et répartitions.
- R13 : clic sur une ligne de charge : liste des personnes concernées, avec le droit nominatif seulement.

## 2. Existant
- `pages/Annuel.tsx` accepte déjà une période quelconque de 1 à 12 mois (`du`/`au`, 28-k) : un mois seul donne le rapport du mois, comparé au mois d'avant. `pages/Mensuel.tsx` n'apportait rien de propre, hormis le bandeau des contrôles de cohérence (écarts de la somme des rubriques, de l'effectif, etc.) : repris dans la nouvelle page quand la période est un seul mois (`/rapports/charges` renvoie alors `controles`, affichés au-dessus des cartes).
- Les « types de charge » sont les rubriques de paie (`rubrique`), sans regroupement en code. Le classement en familles est pourtant tranché (QUESTIONS_CLIENT F5) : Salaires = Brut Réel, Salaire brut garantie ; Primes = Bonus, Primes exceptionnelles, sur ventes, sur résultats, Productivité Ateliers, Commission ; Avantages et frais = Frais de mission, Logement site déporté, Carburant véhicule service, Crédit téléphonique ; le reste (et toute rubrique nouvelle) = Charges.
- Plusieurs rubriques sont hors total par la règle de paie datée (salaire garanti, primes sur ventes, sur résultats, productivité, commission, bonus) : composantes du Brut Réel, ou sorties du total sur décision du client (QUESTIONS_CLIENT F7).
- Les répartitions existantes (site, service, contrat) portent sur la masse totale, pas sur une charge.
- Le détail par personne existe (page Individuel) sous le droit `nominatif:read`, avec journal d'audit.

## 3. Options
| Option | Pour | Contre |
|---|---|---|
| A. Cartes = rubriques une à une | Aucun regroupement à créer | 10 à 16 cartes : pas un « aperçu simplifié » |
| **B. Cartes = familles F5 + Total** | 5 cartes lisibles, classement déjà validé par le client | Une règle de regroupement à coder (côté serveur) |
| C. Nouvelle page sans le rapport complet | Plus légère | Perd l'activité, l'analyse des effectifs, CA et marge, les exports |

## 4. Choix
- Option B. Montant d'une carte = somme des rubriques **comptées** dans le total à la date de chaque mois : la somme des cartes égale le Total, sans double compte. Les rubriques hors total restent visibles dans le détail, en italique, « (non compris dans le total) ».
- La 4e famille s'appelle « Charges employeur » (et non « Charges ») pour ne pas se confondre avec « Toutes les charges ». Absences (en jours) et rubriques d'activité n'entrent dans aucune famille.
- Carte **Toutes les charges** : même tableau que les familles (onglets Type de charge / Site / Service / Activité / Nature de contrat), avec le budget (§ 7), puis la section « Effectifs et activité » (§ 7). Ce que le rapport actuel montre et que la page ne reprend pas : § 6 « Non retenu ».
- Carte d'une famille : tableau par rubrique (N-1, N, variation, variation %, budget quand il existe, part, nombre de personnes), et répartition de la famille en onglets Site / Service / Activité / Nature de contrat.
- Clic sur une ligne : les personnes se déplient sous la ligne, dans le même tableau (§ 7 « Règle n° 1 »). Droits : § 7 « Accès aux détails ».
- `/mensuel` et `/annuel` redirigent vers `/charges` en gardant les paramètres ; le menu n'a plus qu'une entrée.
- Écarts avec R10 à R13 (`etude-retours-reunion-17-11.md`), qui gardent la demande d'origine : « Charges sociales » devient « Charges employeur » ; la carte « Total » devient « Toutes les charges » ; personnes dépliées sous la ligne, pas de tiroir ; détail des personnes pour tous dans leur périmètre (et non « le nombre seul » sans droit nominatif) ; répartition par marque non reprise (§ 6).

## 5. Impacts
- API : `GET /rapports/charges` (familles, rubriques, répartitions, en un appel ; `report:read`) et `GET /rapports/charges/personnes` (`nominatif:read`, 403 sinon ; audit). Mêmes filtres et même période (`du`, `au`, `cmp_du`, `cmp_au`) que `/annuel`. Périmètre appliqué par `scope_for` / `restreindre` comme ailleurs. Montants en `Decimal`.
- Contenu de `/rapports/charges` : par case et par ligne N, N-1, et pour la ligne Primes la comparaison propre (même mois un an avant quand la période est un mois) ; budget, écart et % budget là où § 7 « Budget » le permet, avec la raison quand il manque ; effectif de la ligne et son écart (recrutements − départs), % FO ; sur la carte Toutes les charges, la section « Effectifs et activité » (effectifs par contrat et par activité, indicateurs d'activité, objectifs quand ils s'appliquent, dont celui de masse salariale par vente, nouveau calcul serveur) ; `controles` quand la période est un seul mois. Les filtres et la vue choisie (`dim`) sont des paramètres ; tout est calculé au serveur.
- Aucune migration. Sécurité : noms et montants individuels seulement avec le droit nominatif, lecture journalisée.
- Performance : un appel pour les niveaux 1 et 2 (budget compris), liste des personnes au clic seulement ; la section « Effectifs et activité » n'est chargée que sur la carte Toutes les charges. Le rapport complet n'est plus chargé.

## 6. Risques
- Habitudes de navigation : redirections et libellés clairs.
- Non retenu, à reprendre si le client le demande :
  - les répartitions croisées du rapport actuel (service × activité, site × activité, site × contrat), la répartition par marque (R10 à R13) et le CA / la marge : la page répartit par une seule dimension à la fois, les filtres jouant le rôle du croisement ;
  - les rubriques en jours (autres qu'Absences) restent hors de la page, qui ne porte que sur des montants ;
  - le drapeau « exclu » d'une rubrique suit le dernier mois de la période et non l'ensemble des mois : une rubrique dont l'exclusion change en cours de période garde l'état du dernier mois dans le tableau (la carte, elle, applique la règle mois par mois) ;
  - le montant d'une rubrique portée par une seule personne reste visible sous le seul droit `report:read` (pas de masquage sous un seuil de personnes), le détail nominatif restant sous `nominatif:read`.

## 7. Analyse de l'écran (UX, 38.6 b, d)
Maquette testable retenue : `docs/maquettes/reunion-17-11/charges-v4.html` (§ 8, 19/11). Les versions 1 à 3 sont retirées ; le présent § décrit la v3, la v4 l'emporte là où elles diffèrent.

### Utilisateurs et tâches
| Qui | Ce qu'il vient chercher | Niveau atteint |
|---|---|---|
| Direction (N1, N2) | Combien coûtent nos charges, et ce qui bouge par rapport à avant | 1 (cases), parfois 2 |
| Contrôle de gestion | Quelle rubrique explique l'écart, sur quel site ou service | 2 |
| Tout utilisateur de la page | Qui, dans son périmètre, fait bouger la ligne | 3 (personnes) |

### Règle n° 1 : on ne se perd jamais
Trois niveaux, toujours dans le même ordre : **Toutes les charges › une famille › les personnes d'une ligne**.
1. **Les 5 cases restent affichées** et servent de menu (`aria-pressed`). « Toutes les charges » est choisie à l'ouverture.
2. **Même tableau à chaque niveau 2**, avec les onglets « Répartir par » : type de charge (ou élément de la famille), Site, Service, Activité, Nature de contrat.
3. **Le niveau 3 se déplie sous la ligne, dans le même tableau** : les personnes ont leurs chiffres sous les mêmes colonnes ; une barre marine relie la ligne ouverte à son pied de liste. Une seule ligne ouverte à la fois ; « Replier », Échap ou un nouveau clic la referment.
4. **Le bouton Retour du navigateur** revient à la case et à la répartition précédentes ; l'adresse les garde (lien partageable).
5. **Changer la période** referme la ligne ouverte et garde la case et la répartition.
6. **Ce qui se clique se voit** : chevron › qui tourne, main au survol, toute la ligne cliquable.

### Accès aux détails (décision utilisateur, 18/11)
- Tous ceux qui ont accès à la page voient le détail des personnes **qui les concernent** : le filtre de périmètre (couche dépôt) limite déjà chacun à son périmètre. Pas de masquage sous un seuil de personnes.
- Techniquement : la page reste sous `report:read`, le détail sous `nominatif:read` (403 sinon, consultation journalisée). Le drapeau nominatif est porté par chaque affectation de rôle : l'accorder aux rôles de la page est de la configuration, sans développement.
- Non maquetté : le compte sans drapeau nominatif (ligne non dépliable, ci-dessous).
- **À reconfirmer avec le client** : `QUESTIONS_CLIENT.md` D4 (« directeurs à périmètre : totaux seulement ») et `P0_CADRAGE.md` § 2 (`lecteur_perimetre` sans nominatif) disent l'inverse.
- Remplace l'ancien point « sans droit nominatif, ligne non cliquable ». Si un compte n'a pas le drapeau, la colonne Personnes reste affichée et la ligne ne se déplie pas.

### Hiérarchie de l'information
- Case : nom, montant (gros), « vs sept. 2026 », variation % avec flèche et signe. Une famille qui contient des lignes hors somme l'indique (« + 412,4 M non compris dans le total »).
- Couleurs : une charge qui **augmente est en rouge**, qui **baisse en vert**, dans les cases et le tableau ; le signe et la flèche restent affichés (jamais la couleur seule). Une variation nulle s'écrit 0, sans signe ni couleur.
- En-têtes avec les vrais libellés (« Sept. 2026 », « Oct. 2026 »), « Montants en FCFA » au-dessus ; tri par clic sur l'en-tête (`aria-sort`), la ligne Total reste en bas.
- En-tête collé en haut et ligne Total collée en bas pendant le défilement ; pas de séparateur vertical.
- Lignes non comprises dans le total : italique, mention « (non compris dans le total) », Part « — », note en pied.
- Personnes : nom, étiquette « Entrée » (rien sur la période comparée) ou « Sortie » (rien sur la période), matricule · service · site ; contexte complet au survol ; colonne Part = « % de la ligne ».
- Note en vue Type de charge : « Personnes : une même personne peut figurer sur plusieurs lignes ; cette colonne ne s'additionne pas. » Note des lignes hors total : « Les lignes « non comprises dans le total » le sont par la règle de paie datée : composantes du Brut Réel (salaire garanti, commission, bonus, primes sur ventes) ou sorties du total par décision client (primes sur résultats, productivité ateliers) ; montant affiché pour information, sans être additionné. »

### Période
- Un mois : comparé au mois d'avant, **sauf la case Primes** (saisonnières), comparée au même mois de l'année précédente, avec une note. Dans le tableau de la carte Toutes les charges, la ligne Primes suit la comparaison du total (mois d'avant) ; une note le dit. Bandeau des contrôles du mois neutre, sur une ligne, détail au clic.
- Comparaison choisie par l'utilisateur (« Comparer à ») : toutes les comparaisons la suivent, case Primes comprise.
- Plusieurs mois ou une année : comparé à la même période un an avant ; pas de bandeau de contrôles.

### États
- Chargement : squelette de même taille, pas de saut de page. Vide : message et « Voir le dernier mois importé » (non maquetté). Période comparée sans aucune donnée importée (ex. janv. 2024 comparé à déc. 2023) : N-1, variation et variation % affichent « — », comme les cases. Période comparée en partie avant les données (ex. janv.-mars 2024 comparé à 2023, ou une année à cheval) : calcul sur les mois importés seulement, note « Comparaison partielle » (comme le drapeau `partiel` du serveur). Erreur : message et « Réessayer », filtres conservés.
- Liste des personnes : recherche « Chercher » (nom ou matricule, sans accents) dès 10 personnes ; 50 lignes puis « Afficher 50 de plus », focus conservé.
- Filtre Activité de la liste (comme dans l'appli actuelle) : « Toutes / Front office / Back Office » avec le nombre de personnes ; le choix ajoute une ligne « Sous-total Front office » (montants, variation, % de la ligne) sous les mêmes colonnes et s'applique à l'export Excel et au PDF. Masqué quand le tableau est déjà réparti par Activité ou quand le filtre Activité de la barre est actif. Valeurs = référentiel `ACTIVITES` (`referentiels_init.py`).

### Budget (38.6 d2)
- Colonnes **Budget**, **Écart budget** (N − budget) et **% budget** (N ÷ budget), placées après Var. %, seulement là où un budget est saisi : carte Toutes les charges répartie par type de charge, site ou service ; carte d'une famille répartie par élément. Aucun budget par activité ni par nature de contrat, ni pour une famille répartie par site ou service.
- Budget saisi à partir de janv. 2025 : période qui commence avant = pas de colonnes, note « saisi à partir de janv. 2025 ».
- Avec un filtre, une ligne garde son budget seulement s'il est saisi à ce niveau :

| Filtre actif | Budget par type de charge | Par site | Par service | Total |
|---|---|---|---|---|
| Service, ou compte à périmètre | — | — | oui (sauf filtre Site) | oui |
| Site, Type de site, ou compte limité à des sites | — | oui (sauf filtre Service) | — | oui |
| Activité | — | — | — | oui |
| Poste, Contrat, Employé | — | — | — | — |
| Département | — | — | oui, services du département (sauf filtre Site) | oui |

- Règle serveur (`charger_budgets`) : aucun budget saisi par activité, poste, contrat ou personne ; Type de site garde les budgets de ses sites. Le Total vient de la règle client ci-dessous, d'où « oui » sous Activité ; sous Poste, Contrat ou Employé, le serveur n'en calcule pas (`rapports.py`, `_params` : `budget_employe` vide). Département n'est pas encore un paramètre de `charger_budgets` : à ajouter à l'étape e (décision par défaut ci-dessus).
- Total d'une famille : il n'a de budget que si chacune de ses lignes en a un.

- Ligne sans budget : « — » dans les trois colonnes ; une note dit pourquoi (filtre à retirer ou niveau non saisi).
- Budget total = budget par salarié et par mois × effectif × nombre de mois (règle client) : il ne s'obtient pas en additionnant les lignes, une note le dit.
- Comme pour les charges : dépassement en rouge, sous le budget en vert, signe toujours affiché.

### Effectif et % FO (38.6 d2)
- Carte Toutes les charges répartie par site, service, activité ou contrat : la colonne Personnes s'appelle **Effectif** (personnes présentes sur la période), suivie en petit de l'écart avec la période comparée (+3, −2). Écart = recrutements − départs, comme le tableau Effectifs : la ligne Total des deux tableaux donne le même écart.
- Répartie par site, service ou contrat, sans filtre Activité : colonne **% FO** (part des personnes en Front office), comme le rapport actuel.

### Section « Effectifs et activité » (38.6 d2)
- Sous le tableau de la carte Toutes les charges, deux onglets ; les filtres de la barre s'appliquent.
- **Activité** = le bloc Activité du Reporting global (ventes, clients, OR, devis, factures, productivité), **pas** le Front/Back office (rappel utilisateur du 19/11). Case « Activité · coût par vente » : charges ÷ nombre de ventes (comme « Masse salariale par vente »), vs comparaison, hausse rouge ; 3e ligne « N ventes · objectif réalisé X % » (rouge sous 100 %). Au survol : ventes (et objectif), clients, OR, devis, factures, productivité avec la comparaison, masse salariale par facture atelier. Dépend du périmètre, du service et du site, pas des filtres Activité (FO/BO) ni Contrat.
- **Effectifs** : par nature de contrat puis par activité, effectif début, recrutements, départs, taux de rotation, absences (jours), taux d'absentéisme, effectif fin. Formules en note : rotation = (recrutements + départs) ÷ 2 ÷ effectif moyen ; absentéisme = jours d'absence ÷ (effectif fin × 22 jours ouvrés × nombre de mois), formule du cadrage P0 ; 22 = paramètre « jours ouvrés ».
- **Activité**, libellés du serveur (`LIGNES_ACTIVITE`) : Commercial (Nombre de ventes, Nombre de clients, Ventes par client), Atelier (OR, Devis, Factures, Taux de transformation (factures / devis)), Productivité (Indice de productivité (moyenne), Productifs (effectif), OR par productif, Factures par productif), Coût RH (Masse salariale par vente). Colonnes N-1, N, variation, puis Objectif, Écart objectif, Réalisation quand un objectif existe (« — » sinon).
- Objectifs : seuls ceux saisis au serveur (`OBJECTIFS_ACTIVITE` : ventes, clients, productivité, factures), plus Masse salariale par vente = budget total ÷ objectif de ventes : ce dernier n'existe pas encore au serveur, calcul à ajouter à l'étape e (décision par défaut : le garder). Pas d'objectif pour OR ni Devis.
- Décision par défaut : les objectifs sont fixés pour toute l'entreprise ; ils sont masqués avec un filtre Service ou Site et pour un compte à périmètre (note). L'activité n'est pas répartie par activité ni par contrat : avec ces filtres, l'onglet Activité affiche un message qui dit quel filtre retirer.

### Filtres et onglets grisés (38.6 d2)
- Les filtres Service, Site, Activité et Contrat de la barre s'appliquent aux cases, au tableau, aux personnes et à la section « Effectifs et activité » (filtre de périmètre dans la couche dépôt, comme ailleurs).
- Un onglet « Répartir par » qui n'aurait qu'une valeur dans la sélection (ex. filtre Service, ou compte limité à un service) est **grisé** (`aria-disabled`, infobulle « Un seul service dans la sélection ») ; un clic l'annonce sans changer de vue. Si l'onglet affiché devient grisé, la vue revient à « Type de charge ».
- Sélection vide : les cases se masquent, un message propose « Réinitialiser les filtres ».
- La barre reprend tous les filtres de l'appli, avec ses libellés (Département, Service, Type de site, Site, Activité, Contrat, Poste, Employé), dans le même ordre. Département, Type de site, Poste et Employé s'appliquent de la même façon (budget : tableau ci-dessus ; onglets grisés : règle ci-dessus).
- La maquette rend actifs Service, Site, Activité et Contrat seulement (les autres sont figés sur « Tous », et « Comparer à » sur la comparaison par défaut), offre un seul choix par filtre (l'appli en permet plusieurs) et une case « compte à périmètre » pour simuler un directeur limité à un service. Ses montants, effectifs et budget par salarié sont fictifs.

### Exports, écrans, accessibilité
- PDF (haut à droite) : ce qui est affiché (période et comparaison, filtres, cases, tableau avec son tri et son budget, ligne dépliée, section « Effectifs et activité » avec ses deux onglets sur la carte Toutes les charges, notes, contrôles du mois). Excel de la liste des personnes dans le pied du détail (consultation journalisée).
- Sous 1100 px la page défile ; le tableau défile à l'horizontale dans son cadre ; aucun débordement de page à 390 px.
- Ligne = bouton dans la 1re cellule (`aria-expanded`, `aria-controls`), onglets `tablist` (flèches), annonce courte pour les lecteurs d'écran à l'ouverture, au tri et à la recherche, Échap ferme le calendrier ou la ligne. Contrôle axe : 0 défaut à 1440 et 390 px.

## 8. Maquette v4 (décisions utilisateur du 19/11)
`docs/maquettes/reunion-17-11/charges-v4.html`. Remplace les § 7 précédents là où ils diffèrent.
- Une seule rangée de 5 cases au plus, par priorité : Charges, Effectifs, CA / Marge (masquée dès qu'un filtre est actif ou en périmètre), Charges exclues, Activité (x/y objectifs atteints). Les types de charge (Salaires, Primes…) ne sont plus des cases : l'onglet « Type de charge » les détaille.
- Un seul tableau à la fois, choisi par la case. Onglets : Type de charge / Site / Service / Nature de contrat (Effectifs : Site / Service / Contrat ; Activité et CA : simple bandeau titre).
- Arbre : ligne › Activité (front office / back office) › Contrat › personnes ; onglet Contrat : ligne › Activité › personnes. Un niveau à valeur unique est sauté.
- Colonnes sur une seule ligne : Libellé | N-1 | N | Variation (montant + %) | Part | Effectif | Budget (montant + %).
- Ouvrir une ligne referme ses sœurs ; au plus 3 lignes ouvertes restent figées sous l'en-tête ; ouverture automatique d'un enfant unique ; la ligne cliquée défile sous l'en-tête.
- Personnes : recherche à gauche ; à droite « a–b sur N », ‹ ›, 10/25/50/100 par page ; défilement interne seulement à 50 et 100 ; pied « Consultation enregistrée » et Export.

## 9. Maquette v5 : 6 cases KPI, une par groupe (avis client et utilisateur du 19/11)

Le client ne veut pas de tableau sur cette page : seulement des indicateurs. L'utilisateur a précisé : **6 cases, une par groupe**, pas une case par élément (« ce sont les groupes qui importent »). Maquette `docs/maquettes/reunion-17-11/charges-v5.html` (remplace la v4 dans l'index et les menus ; la v4 reste comme trace).

- **6 cases**, format des cases du Budget réalisé, grille 3 × 2 (2 colonnes sous 900 px, 1 sous 560 px) : Types de charge, Sites, Services, Marques, Activité, Effectifs.
- **Case de charges** : montant de la période (Md/M FCFA) ; « vs <période comparée> » ; variation ▲▼ % (hausse rouge, baisse verte) ; 3e ligne « N éléments · budget réalisé X % » (rouge au-dessus de 100 %). Au survol : montants exacts, budget prévu et écart, 3 plus gros éléments.
- **Budget partiel** : si une partie des éléments a un budget (ex. 8 sites sur 10), le taux porte sur ces éléments seulement (leur montant ÷ leur budget) et la case l'indique « (8/10) ». Aucun budget (marques) ou filtre qui rend le budget invalide : « pas de budget », raison au survol.
- **Les 5 cases de charges ont le même montant** (chaque groupe se somme au total des charges) : ce qui les distingue est le nombre d'éléments, le budget réalisé et le détail au survol.
- **Effectifs** : personnes payées sur la période vs comparaison (écart signé, flèche neutre) ; 3e ligne « X entrées · Y sorties ».
- **Comparaison** et **budget** : règles inchangées (mois précédent, primes au même mois N-1 ; plage = même plage N-1 ; `dispo` côté serveur).
- **Marques** : liste fictive en attendant la liste du client (QR.2).
- Cases non cliquables ; l'export PDF reprend les 6 cases.
- Vérifié (Playwright Edge) : 6 cases, 0 erreur JS, 0 débordement à 1440 et 390 px ; filtre Site et période sur un an.
- Pour le code (étape e) : l'API renvoie, par groupe, `{n, n1, bu, nbu, nb_elements, nb_avec_budget, top3}` pour l'activité les indicateurs du bloc Activité (période et comparaison, objectif ventes) et pour les effectifs `{n, n1, entrees, sorties}` ; plus de tableaux, d'arbre ni de liste de personnes.

### 9 bis. Totaux des anciens tableaux repris dans les cases

Chaque élément de la ligne TOTAL des tableaux v4 est visible dans une case, en liste « libellé | valeur » sous l'indicateur :

| Case | Totaux repris |
|---|---|
| Types de charge, Sites, Services, Marques | montant de la période comparée, variation en FCFA (rouge si hausse), effectif en personnes distinctes + écart, budget prévu, écart au budget (sans budget pour les marques : lignes masquées) ; Types de charge : charges hors total (nombre de rubriques exclues et montant) |
| Activité | objectifs atteints x / y (entreprise entière seulement), masse salariale par facture atelier, chiffre d'affaires + variation, marge + taux de marge, charges ÷ CA + écart en points (CA et marge : niveau global seulement, sinon « global seulement ») |
| Effectifs | effectif de la période comparée, variation (nombre et %), entrées, sorties |

Les 4 cases de charges portent le même total (T.n, T.n1) : un seul montant et une seule variation partout. La colonne « Part » (100 % au total) n'est pas reprise : elle n'apporte rien au niveau du total.

> Les §9 et 9 bis décrivent la v5, remplacée par la maquette validée le 23/11 (`charges.html` : cartes cliquables, vue par axe en arbre, liste des personnes intégrée). Le code suit le §10.

## 10. Mise en œuvre (38.6 e, 23/11)

- **API** `GET /rapports/charges` (filtres de la barre + `departement`) : total, effectif, entrées/sorties, hors total, familles, 5 axes (type, site, service, activité FO/BO, contrat) avec lignes `{m1, m, var, var_pct, part, effectif, budget, enfants?}` et `budget_raison`, effectifs par contrat, bloc Activité, CA/marge (droit `marge:read`), coût par vente, objectifs atteints, `partiel` (mois comparés sans données), `controles` si la période est un seul mois. Montants en chaîne décimale, `var_pct` et `part` en ratio ; la part d'un enfant est relative à son parent.
- **API** `GET /rapports/charges/personnes` (`axe`, `valeur`, `ligne_activite?`) : salariés du périmètre ayant un montant sur la ligne ; droit `nominatif:read` (403 sinon), lecture journalisée (`lecture_charges_personnes`).
- **Serveur** : budgets filtrés par Département via le périmètre ; objectif « masse salariale par vente » = budget MS de la période ÷ objectif ventes.
- **Front** : `pages/Charges.tsx`, `components/charges/*`, lignes figées par `hooks/useLignesFigees.ts` (ResizeObserver).
- **Écarts assumés** : « masse salariale par facture » non reprise ; niveau Activité sauté s'il n'y a qu'une activité ; export de la liste en CSV côté navigateur ; budget d'une ligne = somme des mois qui ont des données ; Marques non cliquable tant que la liste du client manque (QR.2).
- Vérifié : pytest (31 tests charges, suite 657), vitest 379, build ; Playwright 5174 (cartes, vue Types et Sites, arbre déplié, liste des personnes, 0 erreur JS).
