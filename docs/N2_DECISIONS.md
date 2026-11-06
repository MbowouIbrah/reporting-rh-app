# Réunion N2 : ce qui est décidé, ce qui reste ouvert

Mise à jour : 06/11/2026. Le détail de chaque point se trouve dans `QUESTIONS_CLIENT.md` et `DEMANDES_PRESENTATION_3.md`.

Il y a trois listes :
1. **Le client a décidé** : on ne revient pas dessus.
2. **J'ai décidé seul** : c'est en place, et le client peut encore changer d'avis.
3. **En attente** : seul le client peut répondre.

---

## 1. Le client a décidé

**Calcul du total**
- La commission ne compte plus dans le total, sur toutes les pages. Les charges patronales, l'assurance maladie et la formation, elles, restent comptées.
- Le tableau DONNEES fait référence. Ses colonnes hachurées ne comptent pas dans le total : salaire garanti, primes de productivité, primes sur ventes, primes sur résultats.
- « Primes exceptionnelles HS » veut dire **hors salaire**, pas heures supplémentaires. Il n'y a donc plus de colonne « heures supplémentaires ».
- Le bonus ne compte plus qu'une seule fois, car il est déjà dans le Brut Réel (06/11).

**Rémunération globale (06/11)**
- C'est le total, plus deux primes hors total : les primes sur résultats et la productivité.
- Ce chiffre ne peut plus être égal à celui de l'Excel, qui comptait certaines primes deux fois.

**Colonnes**
- L'ordre des colonnes est le même pour tout le monde.
- Glisser une colonne dans la zone hachurée la sort du total, sur tout l'historique.

**Droits**
- Il y a deux administrateurs RH de même niveau, sans circuit de validation.
- Les directeurs ne voient que leur périmètre, en totaux seulement (sans les noms).
- Le CA et la marge sont réservés aux administrateurs et aux lecteurs globaux.
- Le responsable des sites déportés voit le service Sites Déportés.

**Résumé**
- Quand on filtre par site ou par service, les cases CA et marge affichent un tiret : ces chiffres n'existent qu'au global.

**Nouvelles données**
- Les ventes, les clients, la productivité, le CA et la marge par employé arrivent dans le fichier mensuel.
- Les OR, les devis et les factures sont saisis à la main, par site et par service.

**Stagiaires et année fiscale**
- Un stagiaire est une ligne avec le contrat « Stage », sans montant.
- L'année fiscale va d'avril à mars. On peut toujours afficher aussi l'année civile.

**Affichage**
- Les indicateurs et les graphiques affichent les grands chiffres en K et en M. Les tableaux gardent les chiffres complets.
- Tous les graphiques d'argent et d'activité affichent leur objectif.

**Remis à plus tard**
- Le super administrateur.
- Les BU Motors et Equipments.

**Double run**
- On compare les montants importés colonne par colonne, pas les totaux.

## 2. J'ai décidé seul (en place, le client peut corriger)

| Sujet | Ce que j'ai choisi |
|---|---|
| « Productivité » du fichier | C'est un nombre, pas un montant. Il s'appelle « Indice de productivité », pour ne pas le confondre avec la prime. Sur un groupe, on affiche la moyenne. |
| « Référence Annick » | C'est un texte libre, appelé « Référence reporting ». Il n'entre dans aucun calcul. |
| CA par employé et CA saisi | Si un CA est saisi au-dessus (site, service, global), c'est lui qui compte. Sinon, on additionne le CA des employés, avec la mention « partiel ». |
| Qui est un « productif » | Un employé d'un service coché « productif ». SAV PL et SAV Engins sont cochés, et l'administrateur peut changer ces cases. |
| Total saisi et détail saisi qui ne collent pas | Le total saisi compte. La différence s'affiche comme « non réparti ». |
| Objectifs | Ils se saisissent mois par mois, ou en total annuel divisé par 12 (le reste tombe sur le dernier mois). On peut les saisir au niveau global, du site ou du service. |
| Couleur des écarts | Vert quand c'est bon (résultat au-dessus de l'objectif, ou charge sous le budget). Rouge sinon. |
| Frais de mission | Ils restent dans la masse salariale, avec une ligne « dont Frais de mission » et son budget. |
| Salaire et primes | Quatre familles : Salaire, Primes, Avantages et frais, Charges, chacune avec son sous-total. Une nouvelle rubrique va dans Charges. |
| Graphique « Salaire par mois » | Il montre le salaire garanti, pas le Brut Réel. |
| Choix des graphiques | Il est gardé pour chaque utilisateur, et il le retrouve sur tous ses postes. Le PDF ne contient que les graphiques choisis. |
| Stagiaires | Ils comptent dans l'effectif comme les autres. Le filtre « Type de contrat » permet de les mettre à part. |
| Part des MAD | Effectif moyen des MAD divisé par l'effectif moyen total, sur les mois saisis. |
| CA par employé front office | CA cumulé divisé par l'effectif moyen du front office. |
| Type des sites | Tous sont « principal ». L'administrateur peut changer le type. |
| Sites, services, employés | On ne les supprime jamais, on les désactive : l'historique reste lisible. |
| Création d'un employé | Seuls le matricule et le nom sont obligatoires. Le matricule est saisi, jamais inventé par l'application. |
| Export annuel | Il a sa propre disposition, pas celle de l'onglet ANNUEL de l'Excel. |
| Fichier des commerciaux PL (`ANALYSE_COMMERCIAUX_PL`) | Il n'est pas repris tel quel. Ses chiffres passent par les nouvelles colonnes du fichier mensuel. |
| Hébergement | Réseau interne. |

## 3. En attente (seul le client peut répondre)

| Question | Pourquoi c'est bloquant |
|---|---|
| **Double run** : quels deux mois réels comparer, et qui valide (administrateur RH, DRH) ? | Sans cette réponse, pas de mise en service. |
| **Envoi des mails** : quel serveur d'envoi et quelle adresse d'expédition ? | Sans cela, le mot de passe oublié ne peut pas être envoyé. |
| **Adresse finale** de l'application | Il la faut pour les liens des mails. |
| L'« Indice de productivité » : un taux, des heures, autre chose ? | Si c'est un total et pas une moyenne, une seule formule change. |
| Le CA par employé doit-il égaler le CA de l'entreprise ? | Mon choix actuel est en section 2. |
| Les stagiaires doivent-ils compter dans la rotation et l'absentéisme ? | Laissé de côté pour l'instant. |
| Les objectifs annuels sont-ils fixés par année fiscale ou par année civile ? | Les deux sont possibles. Il faut savoir lequel proposer par défaut. |
| Le fichier des commerciaux PL : est-il disponible par mois, avec le matricule ? Faut-il garder les ventes par marque ? | Sans le matricule, impossible de relier ce fichier à la paie. |

**À demander en réunion** : les trois premières lignes. Les autres peuvent venir plus tard, l'application fonctionne déjà avec mes choix.
