# Revue : conflits entre la saisie et la somme des employés (X1)

| N° | Fichier | Classe | Correction | Statut |
|---|---|---|---|---|
| A | `kpi/niveaux.py`, `repos/saisies.py`, `models/pilotage.py`, 0021 | Règle fausse au-dessus de la cellule | Une date par niveau de case, comparaison de la somme à ce niveau | corrigé |
| B | `api/admin.py` | Fuite de données sans droit | Chiffres du conflit CA/marge masqués dans le journal sans droit marge | corrigé |
| B bis | `app/comptes.py:157` | Fuite de données sans droit | CLI local, hors contrôle de droits de l'API | rejeté (lecture par l'administrateur du serveur) |
| C | `api/pilotage.ts`, `Saisie.tsx`, `Enregistre.tsx` | Écran périmé | `apresImport` recharge saisies, pilotage et rapports après validation et annulation | corrigé |
| C bis | `PointsAttention.tsx:174` | Écran périmé | Décisions sur un lot non validé : les sommes ne bougent pas | rejeté (sans objet) |
| D | `ConflitsSaisie.tsx` | Écran périmé | Vue rechargée quand un choix est refusé | corrigé |
| E | tests API, migration, front | Règle sans test | Modification après « Garder », droit marge, migration 0021, données anciennes, somme constante, journal, chiffres périmés, 409 front, rechargement après import | corrigé |
| F | `ConflitsSaisie.tsx`, `format.ts` | Arrondi à l'affichage | `montantExact` : texte du serveur découpé, aucun arrondi | corrigé |
| G | `CartesMois.tsx`, `SaisieDonnees.tsx` | Écran périmé | Conflit masqué tant que la vue affichée est celle d'un autre mois | corrigé |
| H | `api/pilotage.py`, `api/pilotage.ts` | Écrasement concurrent | Le choix envoie les chiffres vus, 409 s'ils ont changé | corrigé |
| I | `ConflitsSaisie.tsx` | Texte inexact | Le texte dit ce qui s'est réellement passé, pas « la plus récente » | corrigé |
| J | `ConflitsSaisie.tsx` | Accessibilité | `role="status"` porté par un `span` : le `h5` reste un titre | corrigé |
| K | `repos/saisies.py` | Docstring périmée | Texte aligné sur la règle | corrigé |
| L | 0021 | Écart SQLite / PostgreSQL | `modifie_le` non nul aussi sous SQLite, index recréé | corrigé |
| M | `kpi/niveaux.py` | Règle fausse | Une saisie sans date n'est jamais battue | corrigé |

## Passe 2 (contre-revue)

| N° | Fichier | Classe | Correction | Statut |
|---|---|---|---|---|
| 1 | `SaisieDonnees.tsx` | Arrondi à l'affichage (F) | `montrerExact` pour conflit, non réparti et à répartir | corrigé |
| 2 | `ConflitsSaisie.tsx`, `SaisieDonnees.tsx` | Perte de saisie sans garde | Choix bloqué tant que la grille est modifiée ; le niveau affiché est gardé | corrigé |
| 3 | `repos/saisies.py` | Règle sur somme zéro | Un 0 importé reste une valeur datée : conforme à la règle, le conflit s'affiche | rejeté (conforme) |
| 4 | `repos/saisies.py`, `imports/service.py`, `api/pilotage.py` | Concurrence | `verrouiller_periodes` avant validation, annulation, saisie et choix | corrigé |
| 5 | `ConflitsSaisie.tsx` | Message perdu | L'erreur reste affichée si le conflit a disparu | corrigé |
| 6 | `SaisieDonnees.tsx` | Code mort | `periodePrec` retiré, la clé de l'onglet suffit | corrigé |
| 7 | `repos/saisies.py`, `kpi/niveaux.py` | Commentaire inexact | Commentaire retiré, texte aligné | corrigé |
| 8 | tests API et front | Test manquant | Même chiffre à une autre échelle, « Prendre la somme », grille bloquée, erreur gardée | corrigé |
| 9 | `kpi/niveaux.py`, `models/donnees.py` | Arrondi de contexte | Limite de 28 chiffres significatifs, hors de portée des montants importés | rejeté (sans effet réel) |

## À vérifier hors de cette passe

- Migration 0021 sur vrai PostgreSQL : vérifiée dans le conteneur (montée, descente, remontée).
- Concurrence (écart 4) : verrou posé, non rejoué avec deux connexions simultanées.
- Superposition de `.saisie-conflits` au-dessus de `.saisie-tuile-action::after` : les boutons du conflit doivent rester cliquables (déjà cliqués en vrai par le script de recette).

## Comportements assumés

- Annuler un lot : la somme revient en arrière, donc elle est datée ; les employés peuvent passer devant une saisie.
- Données anciennes : sans date côté employés, la saisie gagne et l'écart s'affiche comme conflit jusqu'au choix.
