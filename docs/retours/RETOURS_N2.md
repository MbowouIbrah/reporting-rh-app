# Retours de la présentation N2 (06/11/2026)

Notes de réunion reprises en phrases claires. Pour chaque point : ce que je comprends, ce que je fais par défaut, ce qui reste à confirmer.
Complète `docs/QUESTIONS_CLIENT.md` et `docs/N2_DECISIONS.md`.

## 1. Liens d'accès
- **Demande** : envoyer les liens s'ils sont déjà accessibles.
- **État** : accessibles. Adresse de la version de test + 10 liens dans `tools/recette/mail-liens.local.html` (valables 14 jours, PC allumé). À envoyer par l'utilisateur.

## 2. Graphiques exportés modifiables (précisé le 11/11)
- **Demande** : les graphiques doivent rester « vivants » : on les exporte avec leurs données dans un fichier où l'on peut les modifier (copier-coller, glisser-déposer, export / import : le plus simple pour l'utilisateur). Destinations : Excel et PowerPoint, d'autres si possible.
- **Je comprends** : pas une image, mais un vrai graphique Excel / PowerPoint lié à ses données, modifiable dans Office.
- **Par défaut** : étude `docs/etude-formats-export.md` d'abord : Excel (.xlsx, graphique natif + onglet données), PowerPoint (.pptx, graphique natif avec données intégrées), copier-coller vers Office, autres pistes (Google Sheets / Slides via .xlsx / .pptx, CSV, Power BI). Comparaison pour / contre, puis réalisation du choix le plus simple pour l'utilisateur.

## 3. KPI : ratio front office / back office (précisé le 11/11)
- **Demande** : ratio « productifs / administratifs » = **front office / back office**, dans les KPI, **en pourcentage**.
- **Je comprends** : front office et back office sont déjà les deux **activités** de l'appli (`referentiels_init.ACTIVITES`). Ce n'est donc pas la notion de service « productif » (SAV PL, SAV Engins).
- **Affiché en pourcentage** : % front office et % back office de l'effectif total (ex. 62 % / 38 %), en fin de mois ; case KPI dans Mensuel et Annuel. Calcul côté serveur.

## 4. Pourcentages (précisé le 11/11)
- **Par service** : % front office et % back office de l'effectif du service, et % de l'effectif du service sur l'effectif global.
- **Par agence (site)** : % de l'effectif de l'agence sur l'effectif global, et % front / back office comme pour les services.
- **Staff** : mêmes colonnes, masquées par défaut, affichables d'un clic.
- **Par défaut** : base = effectif fin de mois, une décimale ; le global = tout le périmètre visible par l'utilisateur.

## 5. Lien de connexion
- **Demande** : garder l'idée (simple pour inviter). Lien à usage unique, changement de mot de passe obligatoire après la 1re connexion, et mail détaillé pour éviter « ça ne marche pas » au 2e clic.
- **Par défaut** : le lien est grillé dès la 1re utilisation ; la personne doit choisir son mot de passe (champ `doit_changer_mdp` existant) ; le mail explique : lien à usage unique, choix du mot de passe, connexion suivante par identifiant + mot de passe, qui contacter. Un lien déjà utilisé affiche un message clair.

## 6. Détails par agence
- **Demande** : uniformiser avec les autres répartitions.
- **Par défaut** : même présentation que les tableaux par service (mêmes colonnes, totaux, ordre, pourcentages du point 4).

## 7. Nouveau service : SAV Chariot (11/11)
- **Par défaut** : ajouté à la liste des services (migration + `referentiels_init.SERVICES`), coché « productif » comme les autres SAV, rattaché aux périmètres DPS et Equipment comme SAV PL / SAV Engins. L'admin peut changer ces réglages.

## 8. Matricules pour tous (11/11)
- **Annonce du client** : tous les employés (MAD compris) auront un matricule.
- **Aujourd'hui** : un employé sans matricule reçoit un identifiant déduit de son nom (`SM-…`, `imports/regles.py:108`), ce qui peut confondre des homonymes.
- **Par défaut** : une ligne sans matricule devient bloquante à l'import (message clair) ; le rapprochement par le nom reste seulement pour signaler un matricule douteux. Les fiches `SM-` existantes sont gardées et pourront être rattachées à leur vrai matricule.
