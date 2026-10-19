# Plan : application web Reporting RH

## Décisions
- Stack : FastAPI + SQLAlchemy 2 + Alembic + PostgreSQL 16 dédié (aucun port publié) / React 19 + TS + Vite + react-query + recharts. Calquée sur Academy (qui est FastAPI, pas Django).
- Design : tokens et composants de cfaoacademy (DESIGN_SYSTEM.md §1-3, 5, 7, 9-12) réécrits en TSX + extension « tableaux denses » (zébrure, chiffres à droite, fr-FR, négatifs en rouge, total sur --red-soft).
- Données en format long : situation_mensuelle x rubrique -> montant NUMERIC (décimales gardées telles qu'importées). Nouvelle rubrique ou exclusion = une ligne de référentiel (rubrique_regle datée).
- KPI : module Python de fonctions pures sur agrégats SQL, calcul à la volée.
- Import xlsx : staging -> validation par ligne -> rapport d'anomalies -> validation explicite -> lot annulable, idempotent (sha256 + période/matricule).
- Pas de clôture de période (retirée en 07e) : un mois reste modifiable ; chaque écriture est tracée au journal d'audit (avant/après).
- Auth : JWT local (code Academy), cookie httpOnly, claims OIDC. Keycloak/Cerbos non réutilisés (non en production) -> backlog.
- Autorisation : authorize(principal, action, resource) + filtre de périmètre dans la couche dépôt.
- Rôles : rh_admin (seul écrivain), lecteur_global (DRH, DOP), lecteur_perimetre (DOP/DPS Equipment, Dir. commercial VN). Nouvelle personne = nouvelle role_assignment.
- Audit : audit_event (avant/après JSONB). Exports xlsx côté serveur, filtrés par périmètre.
- Déploiement : projet compose séparé (nginx front, api, db) ; un seul location /reporting-rh/ ajouté au nginx d'Academy. pg_dump nocturne chiffré, 30 j.
- Nouveau dépôt reporting-rh-app (backend/, frontend/, deploy/, backlog.md, golden/).

## Modèle de données
periode, salarie, service/activite/site/type_contrat/poste (+ref_alias), situation_mensuelle, rubrique, rubrique_regle, montant, ca_periode (CA + marge saisie), budget, parametre, perimetre, perimetre_regle, utilisateur, role_assignment, lot_import, staging_ligne, import_anomalie, audit_event.

## Phases
| # | Phase | Taille | Acceptation clé |
|---|---|---|---|
| P0 | Cadrage : dictionnaire KPI, matrice rôles, périmètres, backlog.md | S | Validé par l'admin |
| P1 | Socle : squelette back/front, CI, compose, nginx | M | Login servi en HTTPS en staging, CI verte, aucun port DB publié |
| P2 | Auth, RBAC, périmètres, audit | M | Tests rôle x endpoint x périmètre, cas négatifs inclus ; chaque écriture auditée |
| P3 | Modèle, référentiels, import | L | Import V4 = 1 398 lignes, 0 bloquant ; fichier « pièges » -> 1 anomalie localisée/cas ; idempotent ; annulation OK |
| P4 | Moteur KPI + API rapports | L | Parité golden sur 18 périodes, invariants OK, couverture kpi/ >= 90 % |
| P5 | Front : Résumé, Mensuel, Annuel, Individuel, Graphes | L | Playwright par rôle, filtres indépendants par page, conformité RESULTAT_ATTENDU.md |
| P5b | Refonte UI (`docs/PLAN_REFONTE_UI.md`) : tokens, kit de composants, pages, accessibilité, captures avant/après | M (~6,5 j) | Présentation seule : valeurs et masquages inchangés, Playwright par rôle inchangé, Lighthouse accessibilité >= 95, validé par l'admin |
| P6 | Admin et saisie : CRUD, CA et marge, budgets (08c : pilotage du mois dans « Renseigner des données »), rubriques, utilisateurs, historique | M | Tout tracé (clôture retirée en 07e) |
| P7 | Exports xlsx | S | = écran au FCFA près, filtré par périmètre |
| P8 | Double run 2 mois réels Excel vs app | M | Écart nul ou documenté ; validation admin + DRH |
| P9 | Mise en prod : sauvegarde/restauration testées, runbook, rollback, comptes, Excel archivé | S | |

Dépendances : P1 -> P2 / P3 (parallèles) -> P4 -> P5 (+P2) -> P5b ; P6 après P3 et après le kit de composants de P5b (R2) ; P7 après P4 ; P8 après P5+P6.

## Migration et parité
1. Même pipeline d'import + mapping colonnes V4->V5 (Variable -> Commission).
2. Golden : outils injectent V4 dans V5, Excel (COM, comme outils/valide_excel.py) relève Mensuel/Annuel/Résumé/Individuel par période -> golden/*.json. Pas LibreOffice.
3. Tests de parité pytest, tolérance 0,5 FCFA ; exceptions dans golden/ecarts_connus.yaml (11 FCFA d'arrondi ; VAR % 0 vs vide).
4. Second oracle : outils/recette.py porté en fixtures.
5. Rapport de réconciliation période x service x rubrique après chaque import, bloquant si écart.

## Tests
Unitaires kpi/ (cas limites), invariants Hypothesis (A = services = sites ; contrats = CDI+CDD+MAD ; fin = début + R - D), autorisation exhaustive, corpus d'import piégé, parité en gate CI, vitest + Playwright, ruff/mypy/pip-audit/npm audit, migrations montée/descente.

## Questions bloquantes (P0)
1. Fichier réel de données : les DONNEES des V5 sont vides ; seul V4 est peuplé (1 398 lignes, 90 salariés, 01/2025 -> 06/2026). Quel format d'extraction paie mensuelle ?
2. Services composant le périmètre Equipment (Administration ?) ; Commerce VN = service Commerce VN seul ?
3. Lecteurs à périmètre : fiche individuelle/salaires nominatifs ou agrégats seulement ?
4. CA et marge par périmètre (CA est global aujourd'hui) : afficher ou masquer pour lecteurs à périmètre ?
5. Hébergement : location + réseau Docker sur nginx d'Academy OK ? Accès hors réseau interne pour les directeurs ?

## Backlog cycle 2
SSO Keycloak/Cerbos + MFA admin ; délégation de saisie et validation ; import direct SIRH/paie ; PDF + envoi mensuel e-mail ; budgets pluriannuels/prévisions ; alertes de variation ; multi-filiale ; dashboard d'audit ; mobile/hors ligne.
Règle : toute demande hors périmètre cycle 1 va dans backlog.md.
