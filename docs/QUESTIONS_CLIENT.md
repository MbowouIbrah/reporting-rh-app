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

## D. Utilisateurs et droits

| # | Question | Appliqué aujourd'hui |
|---|---|---|
| D1 | Rôle « super administrateur » : que peut-il faire de plus que l'administrateur RH (gérer les autres administrateurs, consulter le journal, modifier le paramétrage) ? Qui le détient ? | **Précisé** : le super administrateur attribue les rôles et permissions, ajoute, désactive ou supprime les utilisateurs. Reporté à plus tard ; aujourd'hui tout administrateur RH gère les comptes. |
| D2 | Plusieurs administrateurs avec saisie limitée à un périmètre, avec ou sans circuit de validation ? | **Confirmé (16/10)** : deux administrateurs RH de même niveau (deux personnes), saisie sur tout, sans circuit de validation. |
| D3 | Périmètre Equipment = SAV PL, SAV Engins, Pneumatique, Sites Déportés (sans Administration) ; Commerce VN = service Commerce VN seul ? | Oui ; **remplacé (16/10)** : périmètre DPS = Commerce Pièces, SAV PL, SAV Engins, Sites Déportés, plus un périmètre par service (Pneumatique, SAV PL, SAV Engins, Sites Déportés) ; voir P0 §2. |
| D4 | Les directeurs à périmètre voient-ils les données nominatives ou seulement des totaux ? | Totaux seulement. |
| D5 | La marge et le taux de marge sont-ils réservés à l'administrateur RH et aux lecteurs globaux ? | Oui (le CA n'existe pas par périmètre). |

## E. Listes de valeurs (sites, services, employés)

| # | Question | Appliqué aujourd'hui |
|---|---|---|
| E1 | Création d'un employé : quels champs sont obligatoires ? Le matricule vient-il toujours de la paie ? | Matricule et nom obligatoires, les autres facultatifs ; matricule saisi, jamais généré. |
| E2 | Un site, un service ou un employé peut-il être supprimé, ou seulement désactivé ? | Désactivation seulement (l'historique reste lisible). |
| E3 | La liste des types de site (principal, agence, déporté) est-elle complète ? Un site « déporté » doit-il être rattaché au service Sites Déportés ? | Liste fermée de trois types, sans lien avec les services. |
| E4 | Départements / BU (Motors, Equipments) : quelle structure (BU > service > site) et dans quels rapports ? | **Confirmé** : pas pour l'instant (backlog). |

## F. Exports et budgets

| # | Question | Appliqué aujourd'hui |
|---|---|---|
| F1 | Garder le filtre automatique sur les en-têtes des fichiers Excel téléchargés (modèles d'import, rapport d'import) ? | Gardé. |
| F2 | Budget de masse salariale de la synthèse : budget par employé × effectif, ou somme des budgets saisis par site ? | Budget par employé × effectif. |
| F3 | Export annuel : reprendre la disposition de l'onglet ANNUEL de l'Excel (rubriques, activités, sites, contrats, effectifs) ? | Disposition propre à l'application. |
| F4 | Objectif annuel réparti sur l'année : un petit total (ex. 10 ventes) donne 0 de janvier à novembre et 10 en décembre. Garder cette règle, ou arrondir mois par mois (1 par mois, le reste en décembre) ? | Total ÷ 12, le reste en décembre. |
| F5 | Familles du tableau des types de charge : Brut Réel et Salaire brut garanti = Salaire ; Bonus, primes exceptionnelles, sur ventes, sur résultats, productivité, commission = Primes ; frais de mission, logement, carburant, crédit téléphonique = Avantages et frais ; le reste = Charges. Correct ? | Oui, ce classement ; une rubrique nouvelle va dans Charges. |
| F6 | Le graphique « Salaire par mois » montre le Salaire brut garanti (et non le Brut Réel) ? | Salaire brut garanti. |
| F7 | Le Bonus est dans le Brut Réel et aussi compté à part : double compte voulu ? Même question pour la rémunération globale (masse salariale + rubriques hors total). | Inchangé, en attente de confirmation. |
| F8 | Choix des graphiques : gardé par navigateur, ou à retrouver sur tous les postes de l'utilisateur ? | Par navigateur. |

## G. Mise en service

| # | Question | Appliqué aujourd'hui |
|---|---|---|
| G1 | Hébergement sous le nginx d'Academy (`/reporting-rh/`), réseau interne seulement, ou accès externe pour les directeurs ? | Réseau interne. |
| G2 | Double run : quels deux mois réels comparer avec l'Excel, et qui valide (administrateur RH, DRH) ? | À fixer. |
