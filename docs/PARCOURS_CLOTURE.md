# Parcours de fin de mois (plan 07)

Écran « Fin de mois » (`/admin/cloture?periode=AAAA-MM&etape=…`), piloté par `GET /parcours?annee&mois`. Statuts calculés côté serveur depuis les tables existantes : aucune nouvelle table, aucune migration. Pas de clôture de mois : tout reste modifiable.

## Étapes (accès libre à toutes, retour arrière permanent)

| # | Étape | Statut |
|---|---|---|
| 1 | Mois : ouvrir (`POST /periodes`, 409 si existant) | Fait si la période existe |
| 2 | Données de paie (modèle, import, saisie) | À faire si 0 ligne ; À revoir si lot « prêt » en attente ; sinon Fait |
| 3 | Contrôles (moteur de `rapports._mensuel`) | À revoir si contrôle bloquant ; sinon Fait |
| 4 | CA du mois | Fait si saisi, sinon « Peut attendre » |
| 5 | Budgets détaillés | Fait si une ligne, sinon « Facultatif » |

Mois non ouvert : Mois et Données « À faire », Contrôles « À faire », CA « Peut attendre », Budgets « Facultatif » ; chaque étape porte une consigne (CA et budgets saisissables dès l'ouverture) et l'écran s'ouvre sur l'étape Mois. Les écarts des contrôles sont listés (`ecarts`) avec un lien vers le rapport mensuel.

## Effectifs automatiques
Aucune saisie ni confirmation. Entrées = présents en M et absents de M-1 ; départs = présents en M-1 et absents de M (uniquement si M-1 contient des données). Affichés dans l'étape Contrôles.

## Interface
Sélecteur mois/année, stepper de 5 pastilles avec badges, contenu défilant dans la hauteur de la fenêtre (`.ecran-admin`). Onglets : Fin de mois · Employés · Accès ; `/admin/periodes` et `/admin/donnees` redirigent vers le parcours.
