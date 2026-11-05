# Étude : gestion des colonnes en administration

## Besoin
Retour de réunion : l'administration doit permettre de **gérer les colonnes** (paie et activité) et de **voir ce qui existe et ce qui est vide**. Les colonnes CA et marge individuels restent facultatives, avec le même droit que le CA global (`marge:read`).

## Existant
- **Modèle** : `Rubrique` (`models/referentiel.py:78`) : libellé unique, unité (`FCFA`, `jours`, `nombre`), ordre, actif, nature (`paie` | `activite`). Une valeur = une ligne `Montant` (`models/donnees.py:96`) ; une case vide n'a pas de ligne.
- **API, déjà là, sans écran** (`api/parametrage.py`) :
  - `GET /parametrage` (`import:read`) liste les rubriques ;
  - `POST /parametrage/rubriques` (`referentiel:write`) en crée une ;
  - `PUT /parametrage/rubriques/{id}` (`referentiel:write`) active ou désactive, et refuse de désactiver une rubrique du moteur KPI (409).
  - Chaque modification est tracée dans le journal.
- **Import** : seules les rubriques actives sont lues (`imports/service.py:74`). Une colonne inconnue est ignorée, avec un avertissement (`imports/regles.py:389`). Une rubrique créée ici est donc lue au prochain import, sans changement de code.
- **Ordre et hachuré** : réglés en glissant les en-têtes dans DONNEES (`PUT /parametrage/colonnes`). C'est un ordre unique pour tous (B6). On ne le refait pas ici.
- **Écran** : `pages/admin/Referentiels.tsx` affiche trois panneaux (Sites, Services, Types de contrat) sur le même modèle (`Bloc`).

## Options
| Option | Pour | Contre |
|---|---|---|
| A. Quatrième panneau « Colonnes » dans Référentiels | Même écran, même composant `Panneau`, même droit `referentiel:write`. Peu de code. | Le panneau est plus large que les autres (plus de colonnes). |
| B. Nouvel onglet d'administration « Colonnes » | Place pour le détail par année | Un onglet de plus dans le menu, de la navigation à refaire |
| C. Tout dans DONNEES (menu sur les en-têtes) | On voit les données à côté | DONNEES est déjà chargé ; une colonne vide n'y apparaît pas forcément |

**Choix : A.** Le panneau prend toute la largeur, sous les trois autres.

## Contenu du panneau « Colonnes »
- **Tableau, une ligne par rubrique**, dans l'ordre global. Colonnes :
  - Libellé ;
  - Nature (Paie / Activité) ;
  - Unité ;
  - **Valeurs** : nombre de cases remplies sur l'année affichée ;
  - **Dernier mois rempli** ;
  - État (Active / Inactive).
- Une rubrique active **sans aucune valeur** sur l'année est marquée « Vide », sans couleur criarde.
- **Ajouter** : libellé, nature, unité. Le serveur refuse déjà une rubrique de paie en `nombre`. La nouvelle colonne apparaît dans le modèle d'import et dans DONNEES.
- **Désactiver / Réactiver** : la colonne n'est plus lue à l'import et n'est plus affichée. L'historique est gardé. Les rubriques du moteur KPI ne se désactivent pas (bouton absent, avec une bulle d'explication).
- **Pas de suppression** ni de renommage : un renommage casserait la lecture des fichiers d'import (correspondance par libellé), et une suppression ferait perdre de l'historique.
- **CA et marge individuels** : visibles dans le panneau seulement avec `marge:read`. Leur nombre de valeurs aussi. Masqués côté serveur, comme ailleurs.

## Serveur
- `GET /parametrage/colonnes/remplissage?annee=` : pour chaque rubrique, le nombre de valeurs et le dernier mois rempli.
  - Lecture en `import:read`, filtrée par périmètre dans la couche dépôt.
  - Sans `marge:read`, CA et marge individuels sont retirés.
  - Une seule requête groupée (`COUNT`, `MAX(periode)` par rubrique) sur `montant` joint à `situation_mensuelle`.
- Pas de migration : tout existe.

## Impacts
- Données : aucun changement de schéma.
- Sécurité : écriture en `referentiel:write`, déjà en place, et masquage `marge:read` côté serveur.
- Performance : une requête groupée par année, indexée par la clé de `montant`.
- Tests : remplissage (compte, mois, périmètre, masquage), et l'écran (liste, vide, ajout, désactivation refusée pour le moteur).

## Risques
- Une rubrique de paie ajoutée par erreur entrerait dans le total de paie. Parade : elle commence hors total (hachurée) tant qu'on ne la glisse pas dans le total. **À confirmer** ; c'est le choix par défaut.
- Désactiver une colonne remplie la fait disparaître des tableaux. Parade : on demande une confirmation qui donne le nombre de valeurs concernées.

## Décidé par défaut (sans retour client)
Panneau dans Référentiels, ni suppression ni renommage, nouvelle rubrique de paie hachurée au départ, et confirmation avant de désactiver une colonne remplie.
