# Demandes de la 3e présentation : analyse

Les demandes notées en réunion sont reprises ici en phrases claires. Pour chacune, on indique :
- **la décision** du client (réponses reçues le 25/10/2026) ;
- ce qu'il reste à faire ;
- les **questions encore ouvertes**.

Ce document complète `docs/QUESTIONS_CLIENT.md`.

## Point bloquant n°1 : les nouvelles données

### Décision
Les nouveaux chiffres arrivent de deux façons.

**a) Par employé, dans le fichier mensuel (DONNEES)**. On ajoute ces colonnes :
- productivité ;
- nombre de ventes ;
- nombre de clients ;
- CA ;
- marge ;
- référence vers le fichier de reporting du client.

Ces chiffres viennent des **fiches individuelles des employés**.

**b) Globaux, saisis à la main comme le CA d'aujourd'hui**, par site et par service :
- nombre d'OR ;
- nombre de devis ;
- nombre de factures.

Un « productif » est un technicien. Le chiffre « productivité » est celui de la colonne.

### Questions encore ouvertes
| # | Question |
|---|---|
| Q0.1 | La colonne « productivité » contient quoi : un nombre (heures, taux en %) ou un montant en FCFA ? Attention : la rubrique « Productivité Ateliers » existe déjà (une prime en FCFA). Il faut un autre nom pour ne pas les confondre. |
| Q0.2 | La colonne « référence Annick » contient quoi : un nom de fichier, un numéro de ligne, un code ? Peut-on avoir un exemple de fichier du client ? |
| Q0.3 | Le CA et la marge par employé : leur somme doit-elle être égale au CA saisi à la main pour l'entreprise ? Si les deux existent et diffèrent, lequel fait foi ? |
| Q0.4 | Les fiches individuelles : sous quelle forme (Excel, logiciel) et qui les remplit ? |

## Fichier complémentaire : `ANALYSE_COMMERCIAUX_PL (003).xlsm`

Ce fichier Excel (avec macros) contient le **reporting individuel des commerciaux PL**. Il sert à analyser les performances de chaque commercial d'une année à l'autre.

### Ses feuilles
- **DONNEES** : la feuille de saisie, une ligne **par commercial et par année**. Colonnes :
  - Année, Nom, Fonction, Service, Site ;
  - SB (salaire brut garanti), Commissions ;
  - Nombre de ventes, Nombre de visites client ;
  - Chiffre d'affaires, Marge brute ;
  - le nombre de ventes de chacune des 9 marques : HINO, HOHAN, JCB, KING LONG, LOVOL, MFTBC, MISC LO, Renault Trucks, Toyota Material Handling.
  - **Elle est vide dans le fichier reçu.**
- **DONNEES_MARQUES** : les ventes par marque, une ligne par commercial, par année et par marque. 297 lignes remplies, de 2021 à 2026, pour 49 noms.
- **REPORTING** : le tableau de bord. On choisit une année cible et une année de comparaison. Il montre :
  - **une synthèse** : SB, commissions, salaire global (SB + commissions), CA, marge brute, écart entre la marge et le salaire, ventes, visites, effectif commercial ;
  - **des ratios** :
    - taux de marge (marge ÷ CA) ;
    - CA moyen par vente ;
    - taux de transformation (ventes ÷ visites) ;
    - coût salarial rapporté à la marge ;
  - **un détail par service et par site** : CA, marge, salaire global, écart ;
  - **un reporting individuel** : un commercial choisi, année par année de 2020 à 2027 ;
  - **ses ventes par marque.**
- **_CALCULS** : les listes de valeurs et des contrôles :
  - doublons ;
  - services ou sites hors liste ;
  - montants saisis en texte ;
  - ventes = somme des marques.

### Ce que l'application peut reprendre
- Tous les indicateurs et ratios ci-dessus, calculés par le serveur. Les macros Excel ne sont pas reprises.
- Le filtre par nom, fonction, service et site. La comparaison entre deux années (cohérent avec la demande 7).
- Les contrôles, ajoutés à ceux de l'import.

### Écarts avec ce qui était prévu
1. **Période** : le fichier compte **par année**, l'application **par mois**. Pour les mois et l'année fiscale (avril → mars), il faut des chiffres mensuels.
2. **Pas de matricule** : le lien avec la paie se fait par le nom. Un nom mal écrit ou porté par deux personnes casse la fusion. Il faut le MATRICULE.
3. **Doublon avec la paie** : SB et Commissions existent déjà dans la paie (« Salaire brut garantie », « Commission »). Il faut une seule source.
4. **Services et sites différents** :
   - les services du fichier (COMMERCIAL PL EQUIP, DIR. COMMERCIALE, DIRECTION GENERALE EQUIP, DIRECTION OPERATION VO/YAMAHA) ne sont pas ceux de l'application ;
   - le site « Bafoussam » n'existe pas dans l'application.
5. **Clients** : le fichier compte les **visites client**, pas un **nombre de clients**.
6. **Productivité** : aucune colonne. Le fichier ne couvre que les commerciaux, pas les techniciens.
7. **Référence Annick** : aucune colonne de ce nom.

### Questions
| # | Question |
|---|---|
| QF.1 | Peut-on avoir ces chiffres **par mois** (une ligne par commercial et par mois) ? Sinon, l'application les montre seulement à l'année. |
| QF.2 | Peut-on ajouter le **MATRICULE** de la paie dans ce fichier ? |
| QF.3 | SB et commissions : faut-il prendre ceux de la paie (déjà importés) ou ceux de ce fichier ? |
| QF.4 | « Nombre de clients » = « Nombre de visites client » ? |
| QF.5 | Faut-il garder les ventes par marque (9 marques) dans l'application ? |
| QF.6 | Comment relier les services et les sites du fichier à ceux de l'application ? Faut-il ajouter Bafoussam ? |
| QF.7 | La productivité des techniciens : dans quel fichier, et avec quelles colonnes ? |
| QF.8 | Ce reporting ne concerne-t-il que les commerciaux PL, ou d'autres équipes auront-elles le même fichier ? |

## Les demandes, une par une

### 1. Afficher le nom de l'utilisateur dans la barre du haut
- **À faire** : afficher le prénom et le nom (ou l'e-mail si le nom manque), à côté du bouton de déconnexion.
- **Questions** : aucune.

### 2. Année fiscale et année civile
- **Décision** :
  - l'année fiscale va du **1er avril au 31 mars** (exemple : avril 2026 à mars 2027) ;
  - on doit pouvoir présenter **les deux** : l'année fiscale et l'année civile.
- **À faire** :
  - un choix « année civile / année fiscale » dans les filtres ;
  - l'appliquer au rapport annuel, aux cumuls depuis le début de l'année et aux graphiques.
- **Questions** :
  - Q2.1 Les budgets sont-ils saisis par année fiscale ou par année civile ?

### 3. Grands chiffres en K ou en M
- **Décision** :
  - K et M dans les indicateurs, le résumé et les graphiques ;
  - les **tableaux gardent les chiffres complets**, pour voir le détail.
- **À faire** : afficher par exemple « 125,4 M » ou « 830 K ».
- **Questions** : aucune. On met un chiffre après la virgule.

### 4. Budget (objectif) dans les graphiques
- **Décision** : les graphiques montrent **toujours** l'objectif pour :
  - la masse salariale ;
  - le CA ;
  - les frais de mission ;
  - la rémunération globale ;
  - la productivité ;
  - les commissions ;
  - la marge ;
  - le nombre de ventes ;
  - le nombre de clients ;
  - le nombre de factures.
- **Nouveaux graphiques, sans objectif** :
  - absences ;
  - assurance ;
  - formation ;
  - logement site déporté ;
  - crédit téléphonique ;
  - carburant.
- **Existe** :
  - un budget de masse salariale (budget par employé × effectif) ;
  - un budget par rubrique, service ou site, qui peut être saisi.
- **Questions** :
  - Q4.1 Les objectifs des chiffres qui ne sont pas des montants (ventes, clients, factures, productivité) : qui les saisit, et à quel niveau (toute l'entreprise, site, service) ?
  - Q4.2 Un objectif différent chaque mois, ou l'objectif annuel divisé par 12 ?

### 5. Stagiaires
- **Décision** : dans le fichier, la colonne « Type Contrat » vaut **Stage**. Les autres colonnes peuvent rester vides.
- **À faire** :
  - ajouter « Stage » aux types de contrat ;
  - accepter une ligne sans montants à l'import ;
  - mettre à jour le contrôle « Total = CDI + CDD + MAD » et le graphique des contrats.
- **Questions** :
  - Q5.1 Les stagiaires comptent-ils dans l'effectif, la rotation et l'absentéisme ?

### 6. OR, devis et factures par productif
- **Décision** :
  - les nombres d'OR, de devis et de factures sont **globaux** ;
  - ils sont **saisis à la main** par site et par service, comme le CA ;
  - ils ne sont pas dans le tableau des employés.
- **À faire** :
  - un écran de saisie (mois × site × service) ;
  - un indicateur « OR (ou factures) par productif » ;
  - un graphique.
- **Questions** :
  - Q6.1 Le nombre de productifs du mois est-il le nombre de techniciens présents dans la paie ? Comment reconnaître un technicien : par le poste, ou par le service (ateliers SAV) ?

### 7. Comparer d'une année à l'autre
- **Décision** : ajouter un **filtre par année**, comme sur le résumé.
- **À faire** : ajouter ce filtre sur la page des graphiques. La comparaison avec N-1 reste affichée.
- **Questions** : aucune.

### 8. Séparer salaire et primes
- **Pas encore de réponse.**
- **Questions** :
  - Q8.1 Quelles rubriques font partie du « salaire », et lesquelles des « primes » ?
  - Q8.2 Certaines primes (primes sur ventes, primes sur résultats, productivité ateliers, commission) sont aujourd'hui **sorties du total**. Faut-il les montrer quand même dans la partie « primes » ?

### 9. CA et marge dans les tableaux
- **Décision** : ajouter des **lignes CA et Marge** dans les tableaux mensuel et annuel.
- **Questions** :
  - Q9.1 Qui peut voir ces lignes ? Aujourd'hui, seuls l'administrateur et les lecteurs globaux voient le CA.

### 10. Ventes, clients, OR et productivité dans les tableaux et graphiques
- **Décision** : les données arrivent comme décrit au point bloquant n°1.
- **À faire** :
  - des lignes dans les tableaux ;
  - un graphique par chiffre, avec son objectif (demande 4).
- **Questions** :
  - Q10.1 « Le CA en terme de résultat » veut-il dire la marge ?

### 11. Frais de mission dans les tableaux
- **Existe** : rubrique de la paie, avec son graphique et son cumul annuel.
- **À faire** : une ligne à part, bien visible, dans les tableaux mensuel et annuel, avec son budget.
- **Questions** :
  - Q11.1 Les frais de mission restent-ils aussi dans la masse salariale ?

### 12. Choisir les graphiques à afficher
- **Pas encore de réponse.** La liste va passer de 4 à environ 20 graphiques, donc ce choix devient utile.
- **À faire (proposition)** : des cases à cocher dans les filtres. Le choix est retenu pour chaque utilisateur.
- **Questions** :
  - Q12.1 Le choix doit-il être retenu à la prochaine connexion ?
  - Q12.2 L'export PDF doit-il contenir seulement les graphiques choisis ?

### 13. Rémunération globale
- **Décision** :
  - nouveau titre : **« Salaire, prime, rémunération et charges »** ;
  - il remplace la phrase actuelle : « Total versé chaque mois : salaires et charges, plus les primes hors total ».
- **Questions** : aucune.

## Ordre proposé

1. **Tout de suite** (rien à attendre) :
   - 1 : le nom dans la barre du haut ;
   - 13 : le nouveau titre ;
   - 3 : K et M ;
   - 7 : le filtre par année ;
   - 5 : les stagiaires ;
   - 9 : les lignes CA et Marge.
2. **Nouvelles données** :
   - les colonnes du fichier DONNEES ;
   - l'écran de saisie des OR, devis et factures ;
   - puis les demandes 6 et 10.
   - Il faut d'abord les réponses Q0.1 à Q0.4 et QF.1 à QF.8.
3. **Budgets** (4) et frais de mission (11), après Q4.1 et Q4.2.
4. **Après les réponses restantes** : 8 (salaire et primes) et 12 (choix des graphiques).
5. **Gros changement, à planifier à part** : 2, l'année fiscale. Elle touche tous les rapports et les cumuls.
