# Revue du point réseau (commit 16-a, `e42b0e4`)

Verdict : non conforme. Scénarios établis par lecture du code (TanStack 5.104 compris), non rejoués. Chemins depuis `frontend/src/`.

## Bloquant
1. Déconnexion en panne (`auth/AuthContext.tsx:166`, avec `:116` et `:98`) : le POST `/auth/logout` échoue en silence, les cookies restent valides. Au retour du réseau, `verifier()` → `getMe` 200 rouvre le compte sans mot de passe (poste partagé). Antérieur au commit. Correction : sur `ErreurReseau`, refuser la déconnexion avec un message, ou marqueur local qui bloque `verifier` et rejoue le logout au retour.

## Importants
2. Un 500 vaut fin de session (`api/client.ts:64`, `auth/AuthContext.tsx:63`) : base coupée → `/auth/refresh` en 500 → `onUnauthorized` ; `/auth/me` en 500 → `me = null`. Correction : `refresh` rend faux seulement sur 401, rejette sinon ; AuthContext : `q.error ? lireProfil() : undefined`.
3. Panne affichée comme « Aucune période » (`hooks/useFiltres.ts:191-192`) : `placeholderData` disparaît après les relances, `vide` vaut vrai, `f.erreur` jamais lu. Pages : Resume:154, Annuel:82, Mensuel:35, Graphes:404, Individuel:230. Correction : `vide: periodes.isSuccess && !derniere`, `Etat` avec `f.erreur` et relance de `periodes`.
4. Nouvel onglet ou compte `doit_changer_mdp` pendant une panne (`auth/AuthContext.tsx:63`, `auth/RequireAuth.tsx:12`) : redirection vers `/login`, hors bandeau, `['me']` en `retry:false`. Correction : écran « Connexion impossible » avec Réessayer et sonde, sans redirection.
5. Promesse non tenue (`components/Etat.tsx:19`, `components/BandeauConnexion.tsx:28`) : A) 504 ou >30 s alors que `/auth/me` répond → « se chargera au retour » mais aucune relance ; B) requête en dernière tentative (`pending`) au retour, ratée par le prédicat `status === 'error'`. Correction : texte réservé à `connexionPerdue()`, sinon « Réessayez » ; au retour relancer aussi les requêtes en cours.
6. Vérification de saisie non relancée (`pages/admin/saisie/GrilleSaisie.tsx:191-194`, `:392`) : « Vérification impossible » et Enregistrer désactivé jusqu'à la prochaine frappe. Correction : `connexionPerdue` (via `useSyncExternalStore`) dans les dépendances de l'effet, ou bouton Réessayer.
7. Données périmées gardées au retour (`components/BandeauConnexion.tsx:28,41`, `main.tsx:29-30`) : serveur seul en panne, `refetchOnMount` faux. Correction : `refetchQueries({ type: 'active', stale: true })` au retour.

## Mineurs
8. Sonde et `connexionRetablie` divergent sur un 500 (`lib/etatConnexion.ts:34`, `api/client.ts:47-48`) : bandeau qui clignote. Une seule règle, partager `PANNE_PASSERELLE`.
9. Corps lu hors de `appel` (`api/client.ts:105,110`) : coupure en réception → erreur générique, pas de délai. Lire le corps sous le minuteur.
10. POST sans délai : `refresh`, `logout`, `verifier` (`api/client.ts:63`, `AuthContext.tsx:166`, `api/saisie.ts:156`). Délai de 15 s.
11. Réseau muet sans `offline` (`api/client.ts:44,121`) : bandeau après ~35 s, squelette ~93 s. Lancer la sonde dès 5 à 10 s d'attente.
12. Sonde lente qui expire après une réponse réussie (`lib/etatConnexion.ts:37`) : ignorer son résultat.
13. Lecteurs d'écran (`components/BandeauConnexion.tsx:34,42-43`) : retour non annoncé, focus perdu. `role="status"` persistant, bouton jamais désactivé, libellé hors de l'alerte.
14. Bandeau fixe sur les totaux collés en bas (`styles/base.css:1625` contre `:375`, `:730`, `:825`) et inerte sous un `<dialog>`. Variable de hauteur pour ces `bottom`.
15. Pas de limite d'erreur autour du `lazy` (`App.tsx:19,52`) : import de Graphes rejeté → page blanche. Limite d'erreur avec `Etat` réseau.
16. `AbortSignal.timeout` absent sur Safari < 16 (`lib/etatConnexion.ts:32`, `api/client.ts:53`) : minuteur manuel.

## Sans écart
Refresh 401, panne pendant le refresh, session expirée avec profil gardé, rotation de jeton, annulations, délai de 30 s hors envois et exports, relances bornées, 502/503/504 classés en panne, impression, contraste du texte du bandeau (5,97:1).

## Non vérifié
Le 500 réel avec base coupée ; lecture la plus lente à 1,8 s ; imports face à `proxy_read_timeout 120s` (`nginx.conf:49`) ; contraste du bouton du bandeau.

## Statut des corrections
| N° | Statut | Correction |
|---|---|---|
| 1 | corrigé | `logout` relance `ErreurReseau` et les 5xx : déconnexion refusée, message dans le menu profil et la page de changement de mot de passe. |
| 2 | corrigé | `refresh` rejette sur 5xx ; AuthContext garde le profil sur erreur. Tests client. |
| 3 | corrigé | `useFiltres` : `vide` seulement sur succès, `erreur` et `relancer` ; les 5 pages affichent `Etat` avec Réessayer. |
| 4 | corrigé | `RequireAuth` : écran « Connexion impossible » avec Réessayer et bandeau, sans redirection. |
| 5 | corrigé | A : aide « se chargera » réservée à `connexionPerdue()`. B : au retour, invalidation des requêtes en erreur ou en relance, puis relecture des actives périmées. |
| 6 | corrigé | Vérification relancée au retour du réseau (`perdue` en dépendance) et bouton Réessayer. |
| 7 | corrigé | `refetchQueries({ type: 'active', stale: true })` au retour. |
| 8 | corrigé | `PANNE_PASSERELLE` partagé, une seule règle. |
| 9 | corrigé | Corps lu dans `appel`, sous le minuteur. |
| 10 | corrigé | 15 s pour login, refresh, logout, vérification de saisie. |
| 11 | corrigé | Sonde lancée après 8 s d'attente. |
| 12 | corrigé | Compteur de réponses : une sonde partie avant une réponse réussie ne déclare plus la panne. Test. |
| 13 | corrigé | Zone `role="status"` toujours présente (panne puis retour annoncés), bouton jamais désactivé. |
| 14 | corrigé / rejeté en partie | `--bandeau-h` retirée des écrans pleine hauteur, ajoutée sous le corps et aux pieds collés (fiche, saisie). Inerte sous un `<dialog>` : rejeté, la sonde automatique toutes les 5 s rend le bouton facultatif. |
| 15 | corrigé | `LimiteErreur` autour de Graphes et Rapport : `Etat` réseau, Réessayer recharge la page. |
| 16 | corrigé | Minuteurs manuels (`AbortController` + `setTimeout`). |

## Contre-revue (passe 2)

| N° | Fichier | Classe | Correction | Statut |
|---|---|---|---|---|
| C1 | `GrilleSaisie.tsx` (effet de vérification) | résultat périmé affiché comme valide | en panne : résultat vidé, « Vérification en attente du réseau. », pas de Réessayer inutile | corrigé |
| C2 | `base.css` (`.rapport-excel … tbody.pied`) | hauteur sans `--bandeau-h` | `calc(100dvh - 160px - var(--bandeau-h, 0px))` | corrigé |
| C3 | `base.css` (`.fiche-barre` ≥ 1360 px) | décalage compté deux fois | `bottom: 0` dans le cadre qui défile seul | corrigé |
| C4 | `LimiteErreur.tsx` | `<main>` en double sous Layout | `<main>` seulement avec `page` (Rapport) | corrigé |
| C5 | `LimiteErreur.tsx` | erreur mal classée | message réseau seulement si le code n'a pas chargé, sinon « Page non affichée » | corrigé |
| C6 | `MenuProfil.tsx` | remplissage vide | message affiché seulement en cas d'échec, effacé à la fermeture | corrigé |
| C7 | `client.ts` (`appel`) | statuts sans corps incomplets | `r.body === null` au lieu de la liste 204/205 | corrigé |
| C8 | `RequireAuth.tsx`, `Etat.tsx` | clic sans retour visible | `enCours` : `aria-busy` et « Vérification… » | corrigé |
| C9 | `client.test.ts` | tests manquants | 204 et sonde après 8 s ajoutés | corrigé ; chemin panne de la grille : différé (pas de test de composant pour la grille, couvert par la relecture) |
| C10 | point 14 (`<dialog>` modal) | annonce inerte sous un dialogue | rejeté : dialogues courts (formulaires), le bandeau visible et l'annonce reprennent à la fermeture | rejeté |
| C11 | sonde après 8 s pendant un import lourd | fausse panne possible si `/auth/me` dépasse 5 s | rejeté : lecture la plus lente mesurée 1,8 s ; la panne se lève à la réponse suivante | rejeté |
