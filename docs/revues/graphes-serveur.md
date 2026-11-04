# Revue : choix des graphiques gardé sur le serveur (B-021)

Revue du 2026-11-04, une passe, 9 écarts.

| N° | Fichier | Classe | Correction | Statut |
|---|---|---|---|---|
| 1 | `backend/app/api/auth.py` `ecrire_preference` | Écriture concurrente (deux premiers envois) | `IntegrityError` rattrapée : la ligne créée par l'autre requête est mise à jour | corrigé |
| 2 | `frontend/src/lib/choixGraphes.ts` `envoyer` | Envois dans le désordre | Un seul envoi à la fois par clé ; seul le dernier choix en attente part | corrigé |
| 3 | `choixGraphes.ts` lecture du serveur | Envoi échoué écrasé au chargement suivant | Marque `<clé>.attente` dans le navigateur tant que le serveur n'a pas reçu ; au chargement, la copie locale est renvoyée au lieu d'être écrasée | corrigé (test) |
| 4 | `choixGraphes.ts` `basculer` | Valeur figée au rendu (deux clics rapides) | `basculer` part du dernier choix (`courant`) | corrigé (test) |
| 5 | `choixGraphes.ts` écoute `storage` | Lecture en route qui écrase un choix d'un autre onglet | L'événement marque le choix comme modifié | corrigé |
| 6 | `auth.py` | Préférences dans le routeur d'authentification | Clé limitée à `graphes.` à dessein (liste blanche) ; un routeur dédié viendra avec un 2e réglage | rejeté |
| 7 | `choixGraphes.ts` | Identifiant relu depuis la clé | `useMonId()` gardé dans une variable | corrigé |
| 8 | `alembic/versions/0019_preference_utilisateur.py` | Type JSON redéfini | Convention des migrations (figées, cf. 0002) : ne pas importer les modèles | rejeté |
| 9 | `frontend/src/api/client.ts` | Session expirée muette sur `/auth/*` | Seul `/auth/me` reste traité par `AuthContext` ; les autres routes renvoient à la connexion | corrigé |

Contre-revue : diff relu, Vitest 194, pytest préférences et migrations 8/8, ruff OK.
