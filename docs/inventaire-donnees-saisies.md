# Inventaire des données à saisir

But : chaque donnée a **une seule** porte d'entrée. Ce document liste ce que l'on saisit aujourd'hui, et où, puis relève les doublons.

## 1. Ce qui se saisit aujourd'hui

| # | Donnée | Nature | Où on la saisit | Granularité |
|---|---|---|---|---|
| D1 | Rubriques de paie (salaire, primes, charges…) | Réalisé, FCFA | Grille employés / import Excel | Employé |
| D2 | Nombre de ventes | Réalisé, nombre | Grille employés / import | Employé |
| D3 | Nombre de clients | Réalisé, nombre | Grille employés / import | Employé |
| D4 | Indice de productivité | Réalisé, nombre (moyenne) | Grille employés / import | Employé |
| D5 | CA | Réalisé, FCFA | Grille employés (« CA individuel ») **et** carte « CA et marge » | Employé **et** global / site / service / site×service |
| D6 | Marge | Réalisé, FCFA | Grille employés (« Marge individuelle ») **et** carte « CA et marge » | Employé **et** global / site / service / site×service |
| D7 | OR | Réalisé, nombre | Carte « OR, devis, factures » | Global / site / service / site×service |
| D8 | Devis | Réalisé, nombre | Carte « OR, devis, factures » | idem |
| D9 | Factures | Réalisé, nombre | Carte « OR, devis, factures » | idem |
| D10 | Objectif CA | Objectif, FCFA | Carte « Objectifs CA et marge » | idem (global par défaut) |
| D11 | Objectif marge | Objectif, FCFA | Carte « Objectifs CA et marge » | idem |
| D12 | Objectif ventes | Objectif, nombre entier | Carte « Objectifs d'activité » | idem |
| D13 | Objectif clients | Objectif, nombre entier | Carte « Objectifs d'activité » | idem |
| D14 | Objectif factures | Objectif, nombre entier | Carte « Objectifs d'activité » | idem |
| D15 | Objectif productivité | Objectif, nombre (moyenne) | Carte « Objectifs d'activité » | idem |
| D16 | Budget par type de charge | Budget, FCFA | Carte « Budgets », axe rubrique | Global, une valeur par type |
| D17 | Budget par service | Budget, FCFA | Carte « Budgets », axe service | Une valeur par service |
| D18 | Budget par site | Budget, FCFA | Carte « Budgets », axe site | Une valeur par site |
| D19 | Budget par employé | Paramètre, FCFA | Paramétrage (`budget_employe`) | Global, daté |

Ces chiffres sont calculés, jamais saisis : le taux de marge, la masse salariale, l'effectif et les totaux.

## 2. Doublons et chevauchements

| Réf. | Constat | Risque |
|---|---|---|
| X1 | **CA et marge (D5, D6) s'entrent à deux endroits** : par employé dans la grille, et par niveau dans la carte. L'ancienne règle R2 donnait toujours raison à la case saisie (remplacée, voir la proposition 1). | On ne sait pas lequel des deux compte. Deux saisies peuvent se contredire en silence (« non réparti »). |
| X2 | **Le budget de masse salariale existe 4 fois (D16 à D19)** : par type de charge, par service, par site, et par employé × effectif. Les trois axes sont indépendants. | Le total par site et le total par service peuvent différer. Le client a choisi « budget par employé × effectif » pour la synthèse (F2), ce qui laisse D16 à D18 en concurrence. |
| X3 | L'activité est coupée en deux. Ventes, clients et productivité se saisissent **par employé** (D2 à D4), alors qu'OR, devis et factures se saisissent **par niveau** (D7 à D9). Leurs objectifs se saisissent tous par niveau. | Ce n'est pas un doublon, mais ce n'est pas lisible. « Ventes » apparaît dans les objectifs sans carte de réalisé à côté. |
| X4 | Les noms « CA et marge » et « Objectifs CA et marge » se ressemblent. | C'est seulement une question de libellé : réalisé et objectif sont bien deux données distinctes. |

## 3. Proposition (choix par défaut)

1. **X1 : règle décidée par l'utilisateur (04/11).** Le CA et la marge restent saisissables côté employés et côté carte, même à des niveaux différents :
   - si les deux existent pour une même case, **la saisie la plus récente l'emporte** ;
   - la carte concernée signale le conflit, par exemple « CA : la somme des employés (x) diffère de la saisie (y). La plus récente est retenue. »
   - **Dater la valeur, pas le fichier** : la date côté employés (table `date_employes`) ne change que si la somme de la case change vraiment. Un import qui corrige seulement des salaires ne crée donc pas de conflit.
   - **Le conflit se règle en un clic** : la carte montre les deux chiffres et deux boutons, « Garder la saisie » et « Prendre la somme des employés ». Le choix compte comme la saisie la plus récente. Il tient jusqu'au prochain changement de la somme des employés.
   - Annulation d'un lot : les cases dont la somme change prennent la date de l'annulation, donc la somme des employés peut redevenir la plus récente. Le conflit s'affiche.
   - Données anciennes : sans date côté employés, la saisie est retenue. Si un écart existe déjà, il s'affiche comme un conflit jusqu'au choix de l'utilisateur, y compris pour un CA global volontairement plus élevé que la somme des employés.
2. **X2 : un seul budget de masse salariale, avec une granularité** (c'est la demande 19.19) :
   - le budget se saisit à un niveau : global, site, service ou site×service, comme les autres données ;
   - les totaux par site et par service se calculent à partir de ce budget ;
   - la répartition par type de charge reste à part : elle est contrôlée, et son total doit égaler le budget saisi ;
   - le budget par employé × effectif (D19) sert de valeur par défaut quand rien n'est saisi.
3. **X3 et X4 : les noms des cartes disent clairement réalisé ou objectif** : « CA et marge réalisés », « OR, devis, factures réalisés », « Objectifs… ». Dans la carte « Objectifs d'activité », on note que ventes, clients et productivité réalisés viennent des employés.

## 4. Points à confirmer par le client

- **X2** : le « % Budget » des rapports doit-il comparer au budget saisi (D16 à D18) ou au budget par employé × effectif (D19, réponse F2) ? Aujourd'hui, les deux existent.
