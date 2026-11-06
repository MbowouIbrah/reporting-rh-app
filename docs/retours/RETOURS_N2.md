# Retours de la présentation N2 (06/11/2026)

Notes de réunion reprises en phrases claires. Pour chaque point : ce que je comprends, ce que je fais par défaut, ce qui reste à confirmer.
Complète `docs/QUESTIONS_CLIENT.md` et `docs/N2_DECISIONS.md`.

## 1. Liens d'accès
- **Demande** : envoyer les liens s'ils sont déjà accessibles.
- **État** : accessibles. Adresse de la version de test + 10 liens dans `tools/recette/mail-liens.local.html` (valables 14 jours, PC allumé). À envoyer par l'utilisateur.

## 2. Exports de fichiers
- **Demande** : ajouter des types d'export (informations à préciser) ; rechercher les formats compatibles « intégrables ».
- **Je comprends** : aujourd'hui l'appli exporte en Excel (.xlsx) et PDF. Le client veut d'autres formats, et des formats qu'il peut intégrer dans ses autres outils (ex. CSV pour un logiciel de paie / BI, PowerPoint pour les présentations, lien vers Power BI).
- **Par défaut** : étude des formats (`docs/etude-formats-export.md`) : CSV (UTF-8, séparateur `;`), PowerPoint, JSON / connecteur Power BI, avec pour / contre. Rien n'est codé avant le retour du client.
- **À confirmer** : quels écrans exporter, dans quel outil le fichier doit être intégré.

## 3. KPI : ratio productifs / administratifs
- **Demande** : ajouter le ratio productifs / administratifs.
- **Je comprends** : productif = salarié d'un service coché « productif » (SAV PL, SAV Engins, `N2_DECISIONS.md:63`) ; administratif = tous les autres. Ratio = effectif productif ÷ effectif administratif.
- **Par défaut** : effectif fin de mois, affiché en KPI (Mensuel, Annuel) et par site. Calcul côté serveur.
- **À confirmer** : ratio en effectif ou en masse salariale (on peut afficher les deux).

## 4. Pourcentages dans les répartitions
- **Demande** : colonne pourcentage pour les activités ; pareil pour le staff, de façon masquée (agence et service + activité).
- **Je comprends** : dans les tableaux par activité, une colonne « % du total ». Dans les tableaux staff (par agence, par service, par activité), la même colonne, masquée par défaut et affichable d'un clic.
- **Par défaut** : % de la masse salariale du tableau (ligne ÷ total), une décimale.

## 5. Lien de connexion
- **Demande** : garder l'idée (simple pour inviter). Lien à usage unique, changement de mot de passe obligatoire après la 1re connexion, et mail détaillé pour éviter « ça ne marche pas » au 2e clic.
- **Par défaut** : le lien est grillé dès la 1re utilisation ; la personne doit choisir son mot de passe (champ `doit_changer_mdp` existant) ; le mail explique : lien à usage unique, choix du mot de passe, connexion suivante par identifiant + mot de passe, qui contacter. Un lien déjà utilisé affiche un message clair.

## 6. Détails par agence
- **Demande** : uniformiser avec les autres répartitions.
- **Par défaut** : même présentation que les tableaux par service / activité (mêmes colonnes, totaux, ordre, pourcentage du point 4).
