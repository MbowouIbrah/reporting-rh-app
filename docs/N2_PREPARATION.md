# Réunion N2 : préparation, écran par écran

Base : la 1re présentation officielle (10/10). Pour chaque écran, deux parties :
- **Déjà vu** : montré en 2e ou en 3e présentation. Un rappel d'une phrase suffit, ne pas réexpliquer.
- **Nouveau, à montrer** : ce que le client n'a jamais vu. **C'est ici qu'il faut passer du temps.**

## Ordre conseillé (environ 40 min)

1. **Connexion par lien** (1 min) : on clique sur le lien du mail et on est dans l'application, sans mot de passe.
2. **Saisie des données** (10 min) : c'est la plus grosse nouveauté.
3. **Mensuel et Annuel** (8 min) : objectifs, activité, familles de charges, année fiscale.
4. **Graphes** (6 min) : groupes de graphiques, objectifs, nouveaux graphiques.
5. **Résumé** (3 min) : retouches seulement.
6. **Individuel** (3 min) : activité par employé.
7. **Règles de calcul** (5 min) : bonus et rémunération globale. Il faut l'expliquer, car les chiffres diffèrent de l'Excel.
8. **Questions en attente** (5 min) : voir `N2_DECISIONS.md`, section 3.

Comptes à utiliser :
- **administrateur** pour la saisie et l'import ;
- **DRH** pour tout voir ;
- **responsable SAV PL** pour montrer un périmètre (pas de noms, pas de CA).

Pour changer de compte : Déconnexion, puis un autre lien du mail.

---

## Saisie des données (Administration › Données)

**Déjà vu** : l'import du fichier mensuel et la saisie du CA et de la marge au global.

**Nouveau, à montrer** :
- **La page de départ** : une petite carte par sujet du mois (CA et marge, activité, objectifs, budgets), avec son total. Un clic sur une carte ouvre sa saisie.
- **La saisie à plusieurs niveaux** :
  - le CA peut être saisi au global, par site ou par service ;
  - une case vide est calculée à partir du détail ;
  - un écart s'affiche comme « non réparti » ;
  - un total incomplet porte la mention « partiel ».
- **Les OR, devis et factures**, saisis par site et par service.
- **Les objectifs** de CA, de marge, de ventes, de clients, de factures et de productivité :
  - saisis mois par mois, ou en total annuel réparti sur 12 mois ;
  - sur l'année civile ou fiscale.
- **Le conflit de saisie** : si deux personnes saisissent la même case, la carte le signale et garde la valeur la plus récente. À montrer sur le CA de Commerce VN, préparé pour la démo.
- **L'import** accepte les nouvelles colonnes d'activité (ventes, clients, productivité, CA et marge par employé, référence) et les stagiaires sans montant.
- **Confort** : Ctrl+S enregistre, et l'application prévient avant de quitter une page avec une saisie non enregistrée.

## Mensuel et Annuel

**Déjà vu** :
- filtres par site, type de site, service et activité ;
- effectifs CDI / CDD / MAD dépliables ;
- ligne TOTAL GÉNÉRAL ;
- lignes CA et Marge sous le total ;
- contrat Stage ;
- flèche de retour en haut.

**Nouveau, à montrer** :
- **Objectifs** : colonnes objectif et écart pour le CA, la marge et l'activité. L'écart est en vert quand c'est bon, en rouge sinon.
- **Bloc ACTIVITÉ** : ventes, clients, indice de productivité, OR, devis, factures, productifs, OR par productif, factures par productif.
- **Familles de charges** : Salaire, Primes, Avantages et frais, Charges, chacune avec son sous-total. Les primes hors total restent visibles, marquées « hors total ».
- **Ligne « dont Frais de mission »** sous le total, avec son budget.
- **Année fiscale** (sur l'Annuel) : choix entre « Année civile » et « Année fiscale (avril → mars) ». L'année s'appelle alors « 2026-27 ».
- **Lisibilité** :
  - les lignes de total restent fixes en bas ;
  - les contrôles de cohérence n'apparaissent qu'en cas d'écart.

## Graphes

**Déjà vu** :
- une courbe d'effectif par contrat ;
- la masse salariale de l'année comparée à N-1 (aire et pointillés) ;
- le titre « Rémunération globale » ;
- l'axe en K et en M ;
- le filtre par année.

**Nouveau, à montrer** :
- **Groupes de 4 graphiques**, choisis dans le menu. « Personnaliser » permet de faire ses propres groupes.
  - Chaque utilisateur retrouve son choix sur tous ses postes.
  - L'administrateur nomme les groupes pour tout le monde, et chacun peut les renommer pour lui seul.
- **La courbe d'objectif** sur les graphiques d'argent et d'activité.
- **Les nouveaux graphiques** : Salaire, Primes, Absences, Assurance, Formation, Logement site déporté, Crédit téléphonique, Carburant, CA, Marge, Ventes, Clients, Factures, OR par productif, Productivité.
- **Le PDF** reprend les groupes cochés, dans l'ordre de l'écran.

## Résumé

**Déjà vu** :
- les 8 cases sur deux lignes (CA, commissions, masse salariale, MAD, marge, primes de productivité, effectif, CA par salarié) ;
- les bulles de détail par contrat ;
- le tableau de suivi mensuel ;
- les filtres ;
- les montants en K et en M.

**Nouveau, à montrer** (en passant, ce sont des retouches) :
- une seule bulle, qui glisse d'une case à l'autre ;
- la page remplit tout l'écran, même sur un grand écran ;
- la case MAD montre en tête la part des MAD dans l'effectif, avec les sites déportés en dessous ;
- avec un filtre, les cases CA et marge restent en place et affichent un tiret ;
- le choix entre année civile et année fiscale.

## Individuel

**Déjà vu** :
- les colonnes dans l'ordre demandé ;
- les colonnes hachurées hors total ;
- les colonnes déplaçables ;
- le filtre par poste ;
- une seule recherche par nom ou matricule.

**Nouveau, à montrer** :
- **Les lignes d'activité de l'employé** : ventes, clients, indice de productivité. Le CA et la marge individuels ne sont visibles qu'avec le droit marge.
- Les filtres dans le même ordre que sur les autres pages, y compris l'année fiscale.
- Un mois sans données affiche « - ».

## Sites, services et colonnes (ancien « Référentiels »)

**Déjà vu** :
- l'ajout de sites, de services et d'employés ;
- le type de site.

**Nouveau, à montrer** :
- **Le nouveau nom** de la page : « Sites, services et colonnes ».
- **La case « productif »** sur chaque service : elle décide qui compte dans « OR par productif ».
- **La gestion des colonnes** :
  - on voit combien chaque rubrique est remplie, année par année ;
  - on peut ajouter une colonne (hors total par défaut) ;
  - désactiver une colonne déjà remplie demande une confirmation.

## Utilisateurs et connexion

**Déjà vu** : les rôles et les périmètres (deux administrateurs, DRH et DOP en lecture globale, directeurs à périmètre).

**Nouveau, à montrer** :
- **Le nom de l'utilisateur** dans la barre du haut.
- **La connexion par lien** :
  - chaque lien est personnel et valable 14 jours ;
  - l'administrateur peut annuler tous les liens.
- **Le premier mot de passe** doit être changé à la première connexion.
- **La perte de réseau** :
  - un bandeau prévient ;
  - un bouton « Réessayer » apparaît ;
  - la page se relance au retour du réseau, et la session est gardée.

## Règles de calcul à expliquer

Ce sont les deux points où les chiffres **ne seront plus ceux de l'Excel**.

1. **Bonus** : il était compté deux fois, une fois dans le Brut Réel et une fois à part. Il ne compte plus qu'une fois.
2. **Rémunération globale** : c'est le total, plus les primes sur résultats et la productivité. Les autres primes hors total sont déjà dans le Brut Réel, donc on ne les ajoute pas une deuxième fois.

C'est pour cela que le double run compare les montants importés colonne par colonne, et non les totaux.

## À dire au début de la démo

- Les montants sont **fictifs**. Les comptes, eux, sont ceux des vraies fonctions.
- Le mail de liens donne un accès administrateur : il ne faut pas le transférer.
