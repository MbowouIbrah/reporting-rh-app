# Étude : retours de la réunion du 17/11

Source : notes de réunion (`retours de reunion 17nov reportingrh.txt`), recopiées et numérotées dans `docs/retours/RETOURS_REUNION_17_11.md`.

## 1. Méthode suivie

Cycle d'une équipe de développement, appliqué à chaque retour :

1. **Recueil** : notes recopiées telles quelles, un numéro par retour (R1 à R14).
2. **Analyse** : chaque retour est mesuré à l'existant (ce qui est déjà là, ce qui manque).
3. **Tri** : trois familles.
   - **Sans maquette** : changement de texte, de réglage ou de comportement, sans nouvelle présentation.
   - **Avec maquette** : la présentation change. Maquette d'abord, choix de l'utilisateur, puis code.
   - **Données du client** : impossible sans une information que seul le client a. Un défaut est posé, la question part au client.
4. **Priorité** (MoSCoW) et **lots** : on livre par lots courts, chacun testé et montré sur 8090.
5. **Maquettes** : 2 ou 3 variantes par écran, avec les couleurs de l'application, dans `docs/maquettes/reunion-17-11/`. Une seule variante retenue par écran.
6. **Réalisation** lot par lot : tests d'abord pour la logique serveur, puis écran, puis contrôle à l'écran (Playwright) sur 8090.
7. **Recette** : parcours visible rejoué, retours cochés dans `RETOURS_REUNION_17_11.md`.

## 2. Analyse des retours

| # | Retour | Existant | Famille | Priorité |
|---|---|---|---|---|
| R1 | Changer le fond de la page de connexion | `Fond.tsx` : photo floutée `images/fond.webp` + voile blanc, commune à toutes les pages | Maquette | Should |
| R2 | Mot de passe oublié par e-mail, via le serveur d'envoi d'une appli qui utilise le helpdesk (Academy) | Tout le circuit existe (`mail.py`, lien 30 min, usage unique). Il manque seulement le serveur d'envoi (`SMTP_HOST` vide). Academy Assist envoie déjà par le relais SMTP CFAO avec l'adresse `helpdeskcm@cfao.com` | Données du client (réglage) | Must |
| R3 | Intégrer les marques dans la structure + filtre Marque | Aucune notion de marque. Seul le fichier des commerciaux PL a 9 marques (ventes par commercial, QF.5) | Données du client + maquette (filtre) | Must |
| R4 | Sélection multiple dans les filtres | Chaque filtre = une seule valeur (`FiltresPeriode.tsx`, liste déroulante) ; le serveur reçoit une valeur par dimension | Maquette | Must |
| R5 | Administration : distinguer agences et sites déportés (aujourd'hui un seul bloc « Sites ») | Le type (`principal` / `agence` / `deporte`) existe en base et se change dans Référentiels, mais la liste est un seul bloc | Maquette légère | Should |
| R6 | Simplifier les filtres de période (calendrier, année, période, comparer à) : choisir une période large ou courte, toujours comparable | 4 réglages séparés (Calendrier, Année, Mois/Période, Comparer à), différents entre Mensuel et Annuel | Maquette | Must |
| R7 | Curseur et survol : ne jamais montrer un curseur de saisie sur un texte fixe, revoir toutes les subtilités de navigation | 65 règles `cursor` éparses, aucun principe commun | Sans maquette (règle globale) + recherche | Must |
| R8 | Renommer « Résumé » en « Budget réalisé » | Menu `Layout.tsx:14`, titre `RÉSUMÉ DES INDICATEURS` | Sans maquette | Must |
| R9 | Front / back office sur le CA, la marge, la masse salariale et les types de contrat (Résumé) | Ratio FO/BO sur l'effectif seulement (`kpi/moteur.py:347`, ligne de la carte Effectif global) | Maquette | Must |
| R10 | Fusionner Annuel et Mensuel en une page « Répartition des charges » | Deux pages presque identiques (mêmes 6 sections, `Mensuel.tsx`, `Annuel.tsx`) ; seule la période change | Maquette | Must |
| R11 | Premier aperçu simplifié : des indicateurs par type de charge, cliquables | La page ouvre sur le tableau « 1. Reporting global » | Maquette | Must |
| R12 | Clic sur un indicateur → tableau détaillé (courant, comparaison, variation…) | Le détail existe dans les tableaux actuels | Maquette | Must |
| R13 | Clic sur une ligne de charge → liste des personnes concernées | Le détail par employé existe (page Individuel, droit nominatif) | Maquette + droits | Should |
| R14 | Tableau et KPI de répartition par marque | Dépend de R3 | Maquette | Should (après R3) |

« Graphiques » : rubrique vide dans les notes, rien à faire.

## 3. Choix

### R2 Mot de passe oublié
- On reprend le **même relais d'envoi qu'Academy Assist** et la même adresse d'expédition (`helpdeskcm@cfao.com`). Aucun code nouveau : réglages `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_TLS` dans `.env` du serveur (`RUNBOOK.md` § mot de passe oublié).
- Les valeurs exactes viennent du `.env` d'Academy en production (non lues ici : ce sont des accès). À poser par l'administrateur du serveur.
- Texte du mail : signature « Reporting RH » pour que la personne sache d'où vient le message.

### R3, R14 Marques
Options :

| Option | Pour | Contre |
|---|---|---|
| A. Colonne « Marque » dans le fichier de paie | Exact, ligne par ligne | Le client doit ajouter la colonne à son export |
| B. Marque rattachée à l'activité ou au service par l'administrateur | Rien à changer côté client | Faux si une activité sert plusieurs marques |
| C. A + B : colonne si présente, sinon marque par défaut de l'activité | Marche tout de suite, se précise ensuite | Deux sources à expliquer |

**Choix : C.** Nouvelle liste « Marques » dans Référentiels ; chaque activité peut avoir une marque par défaut ; l'import lit une colonne « Marque » si elle existe (avec les alias, comme les autres listes). Filtre « Marque » sur toutes les pages, tableau « Répartition par marque » (même présentation que par site / service).
**Question client** : liste des marques et rattachement de chaque employé (ou activité) à une marque.

### R4, R6 Filtres
- **Une barre unique** sur toutes les pages : « Période » + « Comparer à » + les filtres de structure.
- **Période** : un seul choix avec des raccourcis (Mois, Trimestre, Cumul de l'exercice, Année, De… à…). L'année civile / fiscale devient un réglage de l'exercice, plus un filtre.
- **Comparer à** : Même période N-1 (défaut), Période précédente, Objectif, Aucune comparaison. Toujours disponible, quelle que soit la période.
- **Sélection multiple** : liste à cases avec recherche ; résumé dans le bouton (« Douala, Kribi », « 3 sites ») ; Tout / Aucun.
- Serveur : chaque dimension accepte une liste de valeurs ; filtre de périmètre toujours appliqué dans la couche dépôt (inchangé).
- Variantes en maquette : barre en ligne (A) ou panneau de filtres repliable (B).

### R5 Sites
Référentiels : la liste des sites est rangée en trois groupes (Sites principaux, Agences, Sites déportés), chacun avec son nombre ; l'ajout demande le type. Rapports : le filtre « Type de site » existe déjà.

### R7 Curseur et survol
Le principe s'appelle **affordance** (et ses **signifiants**, D. Norman) : chaque élément doit montrer par son aspect ce qu'on peut en faire. Côté écran, on parle des **états d'interaction** (repos, survol, focus, appui, désactivé, chargement) et de la **sémantique du curseur**.

Règles retenues, appliquées partout par une feuille commune (`interactions.css`) :
1. Texte fixe, titres, nombres, cases KPI non cliquables : curseur **flèche** ; le texte reste sélectionnable pour copier un chiffre.
2. Curseur **texte** seulement dans les champs de saisie.
3. Tout ce qui se clique (bouton, lien, ligne dépliable, en-tête triable, carte cliquable) : curseur **main** + changement visible au survol + style de focus au clavier.
4. Désactivé : curseur **interdit** + aspect atténué + raison en infobulle.
5. Info au survol (infobulle) : petit repère (souligné pointillé ou icône ⓘ), jamais d'info cachée sans repère.
6. Chargement : curseur **progression** sur la zone, bouton bloqué pendant l'action (pas de double clic).
7. Bord de colonne redimensionnable : curseur **col-resize** ; élément déplaçable : **grab / grabbing**.
8. Boutons, onglets, en-têtes : texte non sélectionnable (un double clic ne surligne pas le libellé).
9. Survol sans délai visible ; pas de mouvement de mise en page au survol (pas de gras qui élargit le texte).
10. Cible d'au moins 32 px de haut sur ordinateur, 44 px au doigt ; sur téléphone, rien ne dépend du survol.

Contrôle : un script Playwright parcourt chaque page et relève, pour chaque élément visible, le curseur calculé et s'il est cliquable ; tout écart (main sur un élément inerte, texte sur un élément fixe, élément cliquable sans main) est listé puis corrigé.

### R8 Budget réalisé
Menu, titre de page, onglet du navigateur, export PDF et aide : « Budget réalisé ». L'adresse `/resume` reste (anciens liens) ; `/budget-realise` est ajoutée.

### R9 Front / back office dans Budget réalisé
Le calcul serveur existant (`_front_back`, par activité de la ligne) est étendu à la masse salariale, au CA, à la marge et à l'effectif par type de contrat. Une ligne sans activité n'entre dans aucune des deux parts (règle actuelle). Variantes : barre bicolore sous la valeur (A) ou deux chiffres « FO / BO » sous la valeur (B).

### R10 à R13 Répartition des charges
- **Une page** « Répartition des charges » remplace Mensuel et Annuel ; la période de la barre de filtres décide du mois, du cumul ou de l'année. `/mensuel` et `/annuel` redirigent vers la nouvelle page avec la bonne période.
- **Niveau 1** : une rangée de cartes, une par type de charge (Salaires, Primes, Avantages et frais, Charges sociales… = familles actuelles), avec montant, comparaison, écart et écart %. Plus la carte « Total ».
- **Niveau 2** : clic sur une carte → tableau détaillé de cette charge (rubriques, colonnes N-1 / N / Écart / Écart %, comme les autres tableaux) puis les répartitions existantes (site, service et activité, nature de contrat, marque).
- **Niveau 3** : clic sur une ligne de charge → liste des personnes qui ont un montant sur cette ligne (matricule, nom, service, site, montant, comparaison). Seulement pour les comptes qui ont le droit nominatif ; les autres voient le nombre de personnes, sans nom.
- Variantes : détail dans la page sous les cartes (A), panneau latéral pour les personnes (B), navigation par fil d'Ariane (C).

### Variantes retenues (18/11)
- Filtres : **A**, barre en ligne.
- Répartition des charges : **B**, détail sous les cartes et liste des personnes dans un tiroir latéral.
- Front / back office dans Budget réalisé : ni A ni B. On reprend la ligne déjà utilisée dans la carte Effectif global (3e ligne en pourcentage, détail au survol), pour rester cohérent.
- Connexion : **A**, aplat navy avec motif discret.

## 4. Impacts
- **Données** : migration (table `marque`, colonne `marque_id` sur activité et sur la ligne importée). Montants inchangés (NUMERIC).
- **API** : filtres en liste (compatibilité gardée : une seule valeur reste acceptée) ; nouvelle route « personnes d'une charge » (droit nominatif vérifié au serveur, périmètre dans la couche dépôt).
- **Sécurité** : le niveau 3 montre des noms et des montants individuels → droit nominatif obligatoire, journal d'audit comme la page Individuel.
- **Performance** : cartes calculées en un appel ; liste des personnes chargée seulement au clic.
- **Exports** : PDF et Excel suivent la nouvelle page (une seule page, période choisie).
- **Tests** : vitest et pytest mis à jour (pages Mensuel/Annuel fusionnées), recette Playwright `parcours-n2.mjs` adaptée.

## 5. Risques
- Fusion Mensuel / Annuel : gros changement de navigation ; les habitudes et les exports changent. Redirections et libellés clairs.
- Marques sans données du client : le tableau reste vide ou « Non rattaché » tant que la liste n'est pas fournie.
- Sélection multiple : toutes les comparaisons et parts doivent rester justes avec plusieurs valeurs (tests serveur dédiés).

## 6. Lots

| Lot | Contenu | Maquette | Dépend de |
|---|---|---|---|
| L1 | R8 Budget réalisé, R7 curseur et survol, R2 réglage d'envoi (documentation) | Non | — |
| L2 | R5 sites groupés par type (admin) | Légère (dans le lot de maquettes) | — |
| L3 | R4 + R6 nouvelle barre de filtres (multi + période simple) | Oui | — |
| L4 | R9 FO/BO dans Budget réalisé | Oui | — |
| L5 | R10 à R13 Répartition des charges | Oui | L3 |
| L6 | R3 + R14 marques | Oui (filtre, tableau) | L3, réponse client |
| L7 | R1 fond de connexion | Oui | — |

## 7. Questions au client (défaut posé en attendant)
| # | Question | Défaut |
|---|---|---|
| QR.1 | Valeurs du relais d'envoi (celui d'Academy) | Mêmes valeurs qu'Academy, à poser par l'administrateur |
| QR.2 | Liste des marques et rattachement des employés / activités | Liste vide, colonne « Marque » lue si présente |
| QR.3 | Liste exacte des agences et des sites déportés | Types actuels, modifiables dans Référentiels |
