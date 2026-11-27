# Questions à valider avec le client

Mise à jour : 2026-10-30. **Règle (30/10)** : la réponse « appliquée aujourd'hui » vaut décision ; on avance sans attendre de validation. Le client corrige après coup s'il le souhaite. Seules restent en attente les informations que lui seul détient (G2, SMTP, adresse d'expédition, `APP_URL`).

## A. Réponses notées après la 1re présentation (à confirmer)

| # | Question | Appliqué aujourd'hui |
|---|---|---|
| A1 | « Annuel / Mensuel » : simple précision de libellé, ou un écran à créer ? | **Confirmé** : les notes visaient les menus Mensuel et Annuel, aucun écran à créer. |
| A2 | Type de chaque site (principal, agence, déporté) ? | Tous « principal » ; modifiable par l'administrateur. |
| A3 | Les colonnes demandées sous un autre nom correspondent-elles bien à ces rubriques de la paie : « Primes de productivité » = *Productivité Ateliers*, « Marge MAD + TVA » = *TVA & Marge MAD*, « Salaire brut garanti » = *Salaire brut garantie* ? | Oui pour les trois. |

## A2. Réponses de la 2e présentation (16/10, validées)

| # | Question | Appliqué |
|---|---|---|
| Q1 | La commission sort-elle du total partout (résumé, mensuel, annuel) ? Charges patronales, Assurance maladie, Formation restent-elles comptées ? | **Confirmé** : oui partout (règle d'exclusion datée, migration 0010) ; les trois rubriques restent comptées. |
| Q2 | « Responsable des sites déportés » : service Sites Déportés ou tous les sites de type déporté ? | **Confirmé** : le service Sites Déportés. |
| Q3 | Résumé filtré par site ou service : CA et marge n'existent qu'au global. | **Confirmé** : cartes CA, Marge, CA par salarié et colonnes CA/marge masquées, avec une phrase d'explication. |

## B. Reporting individuel

| # | Question | Appliqué aujourd'hui |
|---|---|---|
| B1 | Le TOTAL MENSUEL doit-il exclure les mêmes rubriques que le tableau DONNEES de l'administration (Salaire brut garanti, Primes de productivité, Primes sur ventes, Primes sur résultats) ? | **Confirmé** : le tableau DONNEES fait référence ; colonnes hachurées, placées juste avant le total et non comptées. |
| B2 | « Prime excep HS » | **Confirmé** : HS = hors salaire, pas heures supplémentaires. Une seule colonne Primes exceptionnelles ; la rubrique Heures supplémentaires est retirée (migration 0011). |
| B6 | Déplacer une colonne : ordre propre à chaque utilisateur ou commun ? Peut-on faire entrer/sortir une colonne du total en la glissant ? | **Confirmé (17/10)** : un seul ordre global, suivi par tous les tableaux (Individuel, Données). Glisser une colonne dans la zone hachurée la sort du total, l'en sortir la remet ; effet **sur tout l'historique** (tous les totaux recalculés). |
| B5 | Total budget = budget par employé × effectif du mois : est-ce la bonne règle ? | Oui. |

## C. Indicateurs du résumé (définitions choisies par défaut)

| # | Question | Appliqué aujourd'hui |
|---|---|---|
| C1 | Part des MAD : sur quel effectif ? | Effectif moyen MAD / effectif moyen total, sur les mois de paie saisis. |
| C2 | CA par employé front office : sur quels mois ? | CA cumulé des mois où le CA est saisi / effectif moyen front office des mois de paie saisis ; visible seulement par ceux qui voient la marge. |
| C3 | Que recouvre « MAD » : le type de contrat (mise à disposition) uniquement ? | Oui, type de contrat MAD. |
| C4 | Front office = productifs, back office = administratifs. Comment classer un employé ? | **Décidé (client, 13/11)** : par son **poste** (colonne « Emploi occupé » du fichier de paie). La liste des postes est gérée dans l'appli et chaque poste y est classé Front office ou Back office. L'activité d'un employé découle de son poste ; elle n'est plus lue dans le fichier. « OR par productif » garde la case « productif » des services (inchangé). |
| C5 | % front / back par service et part du service dans l'effectif global : sur quel « global » ? | **Décidé (13/11)** : % front / back de l'effectif du service, et part du service dans l'effectif **de ce que le compte voit** : toute l'entreprise pour un compte qui voit tout ; pour un compte qui voit plusieurs services, la part de chaque service parmi les siens. Montrée à tous. Base : effectif de fin de mois (annuel : dernier mois avec données). |
| C6 | Même chose « par agence » : quels sites ? | **Décidé (13/11)** : tous les sites (principal, agences, sites déportés). Le tableau des sites prend la présentation de celui des services : % front / back de chaque site et part du site dans l'effectif que le compte voit (même règle que C5). |

## D. Utilisateurs et droits

| # | Question | Appliqué aujourd'hui |
|---|---|---|
| D1 | Rôle « super administrateur » : que peut-il faire de plus que l'administrateur RH (gérer les autres administrateurs, consulter le journal, modifier le paramétrage) ? Qui le détient ? | **Précisé** : le super administrateur attribue les rôles et permissions, ajoute, désactive ou supprime les utilisateurs. Reporté à plus tard ; aujourd'hui tout administrateur RH gère les comptes. |
| D2 | Plusieurs administrateurs avec saisie limitée à un périmètre, avec ou sans circuit de validation ? | **Confirmé (16/10)** : deux administrateurs RH de même niveau (deux personnes), saisie sur tout, sans circuit de validation. |
| D3 | Périmètre Equipment = SAV PL, SAV Engins, Pneumatique, Sites Déportés (sans Administration) ; Commerce VN = service Commerce VN seul ? | Oui ; **remplacé (16/10)** : périmètre DPS = Commerce Pièces, SAV PL, SAV Engins, Sites Déportés, plus un périmètre par service (Pneumatique, SAV PL, SAV Engins, Sites Déportés) ; voir P0 §2. |
| D4 | Les directeurs à périmètre voient-ils les données nominatives ou seulement des totaux ? | **Décidé (23/11)** : détail nominatif pour tous, limité à leur périmètre (remplace « totaux seulement »). |
| D5 | La marge et le taux de marge sont-ils réservés à l'administrateur RH et aux lecteurs globaux ? | Oui (le CA n'existe pas par périmètre). |
| D6 | DOP : qui voit quoi ? | **Décidé (13/11), corrigé le jour même** : le DOP Nicolas a une vue globale sur Winpart (Winpart, Motul, Autofast). L'autre DOP voit les départements Equipment et Winpart ; Motors lui sera ajouté plus tard (voir E7). |

## E. Listes de valeurs (sites, services, employés)

| # | Question | Appliqué aujourd'hui |
|---|---|---|
| E1 | Création d'un employé : quels champs sont obligatoires ? Le matricule vient-il toujours de la paie ? | Matricule et nom obligatoires, les autres facultatifs ; matricule saisi, jamais généré. |
| E2 | Un site, un service ou un employé peut-il être supprimé, ou seulement désactivé ? | Désactivation seulement (l'historique reste lisible). |
| E3 | La liste des types de site (principal, agence, déporté) est-elle complète ? Un site « déporté » doit-il être rattaché au service Sites Déportés ? | Liste fermée de trois types, sans lien avec les services. |
| E4 | Départements / BU (Motors, Equipments) : quelle structure (BU > service > site) et dans quels rapports ? | ~~Confirmé : pas pour l'instant (backlog).~~ **Repris (13/11)**, voir E7. |
| E5 | SAV Chariot (ajouté aux données de base, présent au déploiement) : est-il « productif » ? | **Sans objet pour le front / back office** (C4 : par poste). Pour « OR par productif » : coché productif, comme SAV PL et SAV Engins. |
| E6 | Matricule pour tous, MAD compris : que faire d'une ligne importée sans matricule ? | **Décidé (13/11)** : l'import n'est pas bloqué en entier. Chaque ligne sans matricule devient un problème à résoudre (« Erreurs à corriger ») : saisir son matricule ou la rattacher à un employé connu. Fin du choix « Continuer sans matricule » et des identifiants `SM-` pour les nouvelles lignes. Les données de test reçoivent un matricule pour tout le monde. Fiches `SM-` : entièrement retirées (rien en production, seulement des données de test générées) ; plus aucun code ne crée ni n'affiche d'identifiant `SM-`. |
| E7 | Départements (BU) : comment les intégrer ? | **Décidé (13/11)** : les départements deviennent une liste de valeurs gérée dans l'appli (ajout, renommage), et chaque service appartient à un département. Départements : Equipment (tous les services déjà présents), Winpart (services Winpart, Motul, Autofast), Motors (plus tard). Winpart est à la fois un département et un service. À trancher à l'étude : les droits d'un compte (ex. l'autre DOP) se donnent-ils par département plutôt que par liste de services ; filtre et regroupement par département dans les tableaux. |
| E8 | Saisie des données : nouveau fichier source ? | **Décidé (13/11)** : on quitte la saisie de A à Z pour l'import direct de l'export de paie, sur le modèle `BrutFinal1026.CSV` (102 colonnes, `;`, Latin-1 ; modèle vide). Il contient matricule, établissement, département, service, nature du contrat, emploi, catégorie, unité et toutes les rubriques de paie (BRUT, NET A PAYER, charges patronales…). MAD (externes) : hors sujet pour l'instant, on part de ce fichier et on étendra ensuite. À étudier : correspondance avec l'import actuel ; pas de colonne front / back office (réglé par le poste, C4) ; site = colonne « Intitulé établissement » (client, 13/11). Colonnes en double (RETENUE CREDIT DIVERS, RETENUE PAGNES SUPPL) : retenues sur le net, non utilisées par l'appli, ignorées. |
| E9 | Import automatique (fichier de paie déposé dans un dossier) : de quel mois est un fichier ? Le modèle `BrutFinal1026.CSV` n'a pas de colonne mois. Le mois est-il toujours dans le nom (`BrutFinalMMAA`, ici 10/2026) ? | **Décidé (client, 13/11)** : le mois est donné par le nom du fichier. Nom illisible : problème à régler, l'admin choisit le mois (`docs/etude-import-automatique.md`). |
| E10 | Rubriques absentes du fichier de paie. | **Décidé par défaut (13/11, vérifié sur les 102 colonnes de `BrutFinal1026.CSV`)** : Frais de mission = DEPALCEMENT PRO + RAPPEL DEPLAC. PRO. Absences (en jours), Carburant, Crédit téléphonique, Formation : pas des éléments de paie, complétés par l'import Excel. Primes sur ventes / sur résultats : aucune colonne, l'admin peut en rattacher une dans « Correspondance de la paie ». TVA & Marge MAD : avec le fichier MAD, plus tard. |
| E11 | Filtres sexe, âge, ancienneté, catégorie (réunion du 23/11, R4) : l'export de paie contient-il bien les colonnes Civilité, Date de naissance, Date d'embauche et Catégorie ? Sous quels noms exacts et quel format de date ? Un extrait anonymisé de 2-3 lignes suffit. | **En attente.** Défaut : noms de `etude-import-paie.md`, dates JJ/MM/AAAA ; sans ces colonnes, les filtres affichent « Non renseigné » (`docs/etude-filtres-affichage-comparaison.md`). |
| E12 | Tranches d'âge et d'ancienneté des filtres. | **Défaut** : âge < 25, 25-34, 35-44, 45-54, 55+ ; ancienneté < 1 an, 1-3, 3-5, 5-10, 10+. |
| E13 | Confidentialité : une sélection très petite (ex. femmes de 55 ans et plus sur un site) peut révéler la paie d'une personne. Masquer les montants sous un seuil ? | **Défaut** : moins de 3 personnes = montants masqués, sauf pour les comptes qui voient déjà les données nominatives. |

## F. Exports et budgets

| # | Question | Appliqué aujourd'hui |
|---|---|---|
| F1 | Garder le filtre automatique sur les en-têtes des fichiers Excel téléchargés (modèles d'import, rapport d'import) ? | Gardé. |
| F2 | Budget de masse salariale de la synthèse : budget par employé × effectif, ou somme des budgets saisis par site ? | Budget par employé × effectif. |
| F3 | Export annuel : reprendre la disposition de l'onglet ANNUEL de l'Excel (rubriques, activités, sites, contrats, effectifs) ? | Disposition propre à l'application. |
| F4 | Objectif annuel réparti sur l'année : un petit total (ex. 10 ventes) donne 0 de janvier à novembre et 10 en décembre. Garder cette règle, ou arrondir mois par mois (1 par mois, le reste en décembre) ? | Total ÷ 12, le reste en décembre. |
| F5 | Familles du tableau des types de charge : Brut Réel et Salaire brut garanti = Salaire ; Bonus, primes exceptionnelles, sur ventes, sur résultats, productivité, commission = Primes ; frais de mission, logement, carburant, crédit téléphonique = Avantages et frais ; le reste = Charges. Correct ? | Oui, ce classement ; une rubrique nouvelle va dans Charges. |
| F6 | Le graphique « Salaire par mois » montre le Salaire brut garanti (et non le Brut Réel) ? | Salaire brut garanti. |
| F7 | Le Bonus est dans le Brut Réel et aussi compté à part : double compte voulu ? Même question pour la rémunération globale (masse salariale + rubriques hors total). | **Bonus : confirmé (06/11)**, sorti du total (migration 0023), il ne compte plus qu'une fois, dans le Brut Réel. Rémunération globale : **décidé (06/11)** = TOTAL + rubriques hors total, sauf absences et composantes du Brut Réel (salaire garanti, commission, bonus, primes sur ventes) ; reste donc primes sur résultats et productivité. Même règle pour l'objectif. L'Excel (« charges + postes exclus ») les comptait deux fois. |
| F8 | Choix des graphiques : gardé par navigateur, ou à retrouver sur tous les postes de l'utilisateur ? | Gardé sur le serveur, par utilisateur : le même choix sur tous ses postes (04/11, B-021). |
| F9 | Graphiques modifiables (Excel, PowerPoint, autres) : sous quelle forme ? | **Retenu (13/11)** : un seul vrai format de données, utilisable dans toutes les applications, comme les graphiques du service de compte rendu de cfaoacademy. Un bouton par graphique, « Copier » ou « Exporter » : on colle ou on glisse le graphique dans Excel, PowerPoint ou Word, et il y reste modifiable. Limite technique : un navigateur ne peut pas mettre un vrai graphique Office dans le presse-papiers (seulement une image, un tableau ou du texte). Défaut : « Exporter » donne un fichier Excel avec le vrai graphique et ses données ; une fois ce graphique copié depuis Excel, il se colle modifiable dans PowerPoint ou Word. « Copier » met l'image et le tableau de données dans le presse-papiers. Mécanisme de cfaoacademy (compte rendu, `services/apercu/classeurs.py`) : pas de presse-papiers ; le serveur produit un PPTX où chaque graphique est un **classeur Excel embarqué** (modifiable au double-clic), avec son image redessinée par LibreOffice. Même principe ici : un vrai graphique Excel (données + graphique) qui sert partout, livré en .xlsx et embarqué dans un .pptx. |

## G. Mise en service

| # | Question | Appliqué aujourd'hui |
|---|---|---|
| G1 | Hébergement sous le nginx d'Academy (`/reporting-rh/`), réseau interne seulement, ou accès externe pour les directeurs ? | Réseau interne. |
| G2 | Double run : quels deux mois réels comparer avec l'Excel, et qui valide (administrateur RH, DRH) ? | **Décidé (06/11)** : les règles ont changé (Commission et Bonus hors total, rémunération globale), les totaux de l'Excel ne peuvent plus être identiques. On compare seulement les montants importés, rubrique par rubrique (colonne par colonne), pas les totaux. **Décidé (13/11)** : pas de données réelles, donc pas de question au client ; la comparaison se fait sur les données de test, par nous. |
