# Étude : choix des graphiques gardé sur le serveur (B-021)

## Besoin
Aujourd'hui, la liste des graphiques masqués (page Graphes, et le PDF qui suit ce choix) est gardée dans le navigateur
(`localStorage`, clé `reporting-rh.graphes.<id>.<page>`). Sur un autre poste ou un autre navigateur, l'utilisateur
retrouve tous les graphiques. Le choix doit le suivre partout.

## Existant
- Front : `frontend/src/lib/choixGraphes.ts` (`useChoixGraphes`, liste des masqués, suivi des autres onglets),
  utilisé par `pages/Graphes.tsx` et `components/ChoixGraphes.tsx`.
- Serveur : aucune préférence utilisateur stockée. `/auth/me` renvoie l'identité ; `Principal.user_id` est connu
  sur toute route authentifiée.

## Options
| Option | Pour | Contre |
|---|---|---|
| A. Table `preference_utilisateur` (utilisateur, clé, valeur JSON) + `GET/PUT /auth/preferences/{cle}` | Générique (d'autres réglages pourront s'y ranger), une ligne par réglage, suppression en cascade avec l'utilisateur | Une migration, deux routes |
| B. Colonne JSON `preferences` sur `utilisateur` | Pas de nouvelle table | Écritures concurrentes de réglages différents s'écrasent ; colonne qui grossit |
| C. Rester en `localStorage` | Rien à faire | Ne répond pas au besoin |

## Choix : A
- Migration `0019_preference_utilisateur` ; contrainte d'unicité (utilisateur, clé).
- Clés acceptées : `graphes.<page>` (lettres minuscules et `_`), valeur = liste de 50 identifiants au plus,
  50 caractères chacun. Liste vide gardée (tout affiché) : elle se distingue de « jamais enregistré », sinon
  un autre poste renverrait sa vieille copie locale après un « Tout afficher ».
- Chacun ne lit et n'écrit que ses propres préférences (aucune permission en plus, l'identité suffit).
- Front : le navigateur garde une copie (affichage immédiat, suivi des autres onglets) ; la valeur du serveur
  prime dès qu'elle arrive. Si le serveur n'a jamais rien reçu et que le navigateur a un choix (ancien fonctionnement),
  ce choix est envoyé au serveur une fois (reprise sans perte). Si l'envoi échoue, le choix reste local.

## Impacts / risques
- Données : petite table, aucune donnée existante touchée. Descente de migration = table supprimée.
- Sécurité : routes limitées à l'utilisateur connecté, valeur bornée en taille.
- Aucun point à trancher par le client.
