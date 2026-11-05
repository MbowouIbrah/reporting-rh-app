# Étude : perte de connexion

## Besoin
Retour de réunion : quand le réseau tombe, l'utilisateur doit le savoir, pouvoir réessayer, et la page doit reprendre seule au retour du réseau. Aucune logique métier touchée, aucune dépendance ajoutée.

## Existant
- `api/client.ts` : `fetch` sans gestion de panne. Une panne remonte en `TypeError`, affichée « Une erreur est survenue ».
- React Query en mode réseau par défaut : si le navigateur se dit hors ligne, requêtes et enregistrements restent en pause, sans erreur ni fin (reproduit : au moins 20 s).
- `AuthContext` : un `/auth/me` en panne donne `me = null`, donc la page de connexion, alors que la session reste valide. Un 401 suivi d'un `/auth/refresh` en panne déconnecte aussi.
- `Etat.tsx` : un seul état d'erreur générique ; `Réessayer` absent sur les pages de rapport.

## Options
| Option | Pour | Contre |
|---|---|---|
| A. Se fier à `navigator.onLine` | Très simple | Faux si le serveur seul est tombé ; ne voit pas un réseau qui bloque |
| B. Requêtes en pause gardées, bandeau en plus | Reprise automatique fournie | Deux chemins de panne ; squelette sans fin ; enregistrements bloqués |
| **C. Mode `always` et sonde serveur** | Un seul chemin : toute panne devient une erreur explicite ; couvre réseau et serveur | Sonde toutes les 5 s pendant la panne ; relance à écrire |

## Choix : C
- Erreur `ErreurReseau` pour : échec du `fetch`, passerelle 502/503/504, lecture sans réponse après 30 s.
- `lib/etatConnexion.ts` : seule une sonde (`GET /auth/me`, 5 s au plus) déclare la connexion perdue. Une requête isolée qui échoue ne suffit pas, ce qui évite les fausses alertes. Toute réponse du serveur rétablit l'état.
- Pendant la panne : sonde toutes les 5 s, et au passage en ligne ou hors ligne du navigateur. Au retour : relance des requêtes en erreur.
- Bandeau fixe en bas d'écran, hors du flux : les pages à hauteur mesurée (Individuel, Mensuel) ne bougent pas.
- Pendant la panne, pas de relecture en arrière-plan : les données déjà affichées restent à l'écran sans message d'erreur.
- Session : une panne ne déconnecte plus ; le profil gardé dans l'onglet reste utilisé.
- `Etat` distingue la panne de connexion (`reseau`) de l'erreur serveur (`serveur`), avec `Réessayer` sur les pages de rapport.

## Impacts
Données et migrations : aucun. Sécurité : le profil gardé ne sert qu'à l'affichage, le serveur contrôle chaque requête. Performance : une petite requête toutes les 5 s, seulement pendant une panne. Déploiement : frontend seul.

## Risques
- Une lecture de plus de 30 s serait vue comme une panne. Plus lente mesurée : 1,8 s. Les imports et exports en POST n'ont pas de limite.
- Page de connexion : pas de bandeau (hors `Layout`), le message d'échec y suffit.
