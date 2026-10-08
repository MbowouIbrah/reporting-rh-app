# Plan P6 : administration et saisie

> Historique. La clôture et la réouverture de période décrites ici ont été retirées en 07e (routes, verrou `exiger_ouverte`, colonnes `statut`/`close_le`/`close_par`, migration 0007).

Le backend couvre déjà utilisateurs, périmètres, clôture/réouverture et audit (`app/api/admin.py`, `app/api/periodes.py`). Le front n'a aucun écran d'administration. Les écrans utilisent le kit (`frontend/DESIGN.md`).

## Décisions
- Renommage d'un service ou d'un site : propagé dans la même transaction (référentiel, `perimetre_regle.valeur`, alias de l'ancien libellé), avec audit. Libellé déjà pris : 409.
- Rubriques : renommage interdit (409) pour les libellés codés en dur dans `app/kpi/moteur.py` (ABSENCES, COMMISSION, PRIMES).
- Migration des règles de périmètre vers des id : au backlog.

## Socle commun (dans 06-a)
- `security/policy.py` : ajouter à ADMIN `saisie:write` et `referentiel:write`.
- `repos/verrou.py` : `exiger_ouverte(db, periode_id)` lève 409 « Période close » ; appelé par toute écriture datée.
- `Kit.tsx` : `Champ` (label, erreur, `aria-invalid`), `ChampMontant` (chaîne, jamais float), `Confirmer` (`<dialog>`).
- `frontend/src/api/admin.ts` : `useMutation` + invalidation des clés `rapports`.
- `App.tsx` : routes `/admin/*` avec garde de permission ; `Layout` : groupe de menu « Administration » selon `can()`.
- Factoriser `_flush`/`_commit` + audit dans `app/api/_commun.py`.

## Étapes
1. **06-a Périodes, clôture, CA** : `PUT /periodes/{pid}/ca {valeur: str|null}` (`saisie:write`, `exiger_ouverte`, audit avant/après ; null supprime la ligne `CaPeriode`), CA dans `_periode()`. Front `pages/admin/Periodes.tsx` (statut en Badge, CA éditable, clôture via `Confirmer`, réouverture avec motif >= 5 caractères). Pas de migration. Tests : `test_saisie_api.py` (200 + audit, 409 close, 403 lecteur, null, Decimal exact), vitest `Periodes.test.tsx`.
2. **06-b Utilisateurs et périmètres** (front surtout) : `GET /audit?entite=&entite_id=&offset=`, pages Utilisateurs et Périmètres (règles choisies dans `/referentiels/{dim}`). Garde 409 : jamais zéro admin actif.
3. **06-c Référentiels** : `PUT /referentiels/{dim}/{id} {libelle?, actif?}` (`referentiel:write`), propagation + alias + audit ; aperçu « N périmètres mis à jour ». Test : un lecteur de périmètre voit encore ses données après renommage ; l'import avec l'ancien libellé est résolu.
4. **06-d Rubriques et paramètres datés** : `api/parametrage.py` (rubriques, règles d'exclusion datées, `jours_ouvres`, `budget_employe`). Refus 409 si une date tombe dans un mois clos ; une règle existante n'est jamais modifiée (on pose `date_fin` et on crée la suivante). `test_parite_golden` reste vert.
5. **06-e Budgets site/service/rubrique** : migration 0005, table `budget` (`periode_id`, `axe` IN rubrique|service|site, `cible_id`, `valeur` NUMERIC(18,3), UNIQUE). API `GET /budgets`, `PUT /budgets/{pid}`, copie depuis un mois. Filtre de périmètre dans `chargement.py` (pas de budget par rubrique pour un non-global). Moteur : budget/écart sur blocs A, B, C. Total inchangé : `budget_employe x effectif`.
6. **06-f Journal** : page Journal (filtres, diff avant/après), lien « Historique », Playwright `e2e/admin.spec.ts` (ports 8100/5180).

## Questions ouvertes (à trancher avant 06-e)
- Total du budget : formule seule, ou saisie possible ?
- Budgets mensuels uniquement (pluriannuel hors périmètre) ?

## Vérifications à chaque étape
`pytest -q`, `ruff check .`, `npm run build && npm test`, axe sans violation sur les nouvelles pages. Montants saisis à vérifier sur PG (SQLite renvoie des float).
