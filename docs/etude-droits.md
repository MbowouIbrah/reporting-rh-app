# Étude : refonte des droits (fonction ≠ droits)

Date : 2026-10-20. Statut : validée le 2026-10-20 (réponses au §7).

## 1. Besoin
Demande du 20/10 :
- Les « rôles » actuels (Administrateur RH, Lecteur global, Lecteur de périmètre) sont en fait des **intitulés de poste**. Ils ne doivent plus porter les droits.
- Chaque compte reçoit des **permissions** accordées ou retirées une par une.
- Par défaut, tout le monde **lit**, mais seulement les **données accordées** (services, sites, périmètres…).
- Interface simple, **sans fenêtre modale** si possible.

Contraintes qui restent (P0 §2, QUESTIONS_CLIENT D1–D5, Q2–Q3) :
- Filtre des données côté serveur, dans la couche dépôt (`app/repos/scope.py`), jamais côté front.
- CA et marge n'existent qu'au global : impossible de les montrer « par périmètre ».
- Lecture d'une fiche individuelle journalisée ; toute écriture tracée (`audit_event`).
- Deux administrateurs RH de même niveau, saisie sur tout (D2). Super administrateur (D1) : plus tard, mais la gestion des comptes doit pouvoir être isolée.

## 2. Existant
| Élément | Où | Constat |
|---|---|---|
| Rôles → actions | `security/policy.py` : `POLICY` (3 rôles, 12 actions) | Les droits sont figés par rôle ; seul le drapeau `nominatif` se règle par compte. |
| Affectation | `models/auth.py` : `RoleAssignment(role, perimetre_id, nominatif)` | Un rôle, un périmètre optionnel, un drapeau. |
| Périmètres | `Perimetre` + `PerimetreRegle(dimension service/site, valeur)` | Groupes nommés réutilisables (DPS = 4 services). Bon outil, à garder. |
| Filtre de données | `repos/scope.py` : `scope_for` / `apply_scope` | Global si rôle global ; sinon **union** (OU) de toutes les règles, service et site confondus. |
| Contrôle des appels | ~60 appels `authorize(p, "action")` / `is_allowed` dans `api/*.py` | Raisonnent déjà en **actions**, pas en rôles : ils ne changent pas si `Principal` porte des permissions. |
| Front | `AuthContext.can(p)` sur `me.permissions` | Déjà fondé sur les permissions. Seules la page Utilisateurs, `lib/roles.ts`, `api/admin.ts` connaissent les rôles. |
| Recette | `tools/recette/comptes.csv` (colonnes `role;perimetre;nominatif;profil`), `reinit.py`, e2e `40-utilisateurs`, `60-lecteurs` | À adapter. |
| Données filtrables | `SituationMensuelle` : service, site, activité, type de contrat, poste | Seuls service et site sont utilisés pour limiter aujourd'hui. |

## 3. Bonnes pratiques retenues
- **Séparer qui on est de ce qu'on peut faire** : la fonction (DRH, DPS…) est une étiquette ; les droits sont attribués à part (principe NIST RBAC : rôle = ensemble de permissions, pas un titre).
- **Moindre privilège, refus par défaut** : un compte neuf ne voit aucune donnée tant qu'on ne lui en accorde pas.
- **Deux axes indépendants** : *quoi faire* (permissions d'action) et *sur quoi* (portée des données, logique ABAC). Mélanger les deux crée l'explosion de rôles (« lecteur SAV avec noms », « lecteur SAV sans noms »…).
- **Modèles plutôt que rôles rigides** : un modèle pré-remplit un compte (« comme un directeur de périmètre »), puis on ajuste. Le compte garde ses droits même si le modèle change.
- **Garde-fous** : on ne peut pas se retirer à soi-même la gestion des comptes ; il reste toujours au moins un compte actif qui gère les comptes ; tout changement de droit est journalisé.

## 4. Options
| Option | Principe | Pour | Contre |
|---|---|---|---|
| A. Rôles + exceptions | On garde les 3 rôles, on ajoute « accorder / retirer » par compte | Peu de migration | Garde la confusion poste = droits ; lecture d'un compte difficile (rôle + exceptions) |
| B. Rôles personnalisables | L'admin crée ses propres rôles (groupes de permissions) et les affecte | Standard RBAC, utile à grande échelle | Écran de plus ; pour ~10 comptes, autant de rôles que de personnes |
| **C. Permissions et portée par compte** (+ modèles de pré-remplissage) | Chaque compte : une fonction (texte libre), une portée de données, une liste de permissions cochées | Exactement la demande ; tout se lit sur une seule fiche ; aucun nouvel écran de rôles | Changer « tous les directeurs » = compte par compte (acceptable à 10 comptes) |

**Choix : C.** Les périmètres nommés restent le moyen de grouper des services (on modifie DPS une fois, tous les comptes DPS suivent).

## 5. Conception proposée
### Données
- `utilisateur.fonction` (texte, ex. « DRH », « Directeur commercial VN ») : affiché, sans aucun effet sur les droits.
- `utilisateur_permission(utilisateur_id, permission)` : permissions accordées.
- `utilisateur_portee(utilisateur_id, type, valeur)` : données accordées. `type` ∈ `tout`, `perimetre`, `service`, `site`.
- Migration Alembic 0014 : conversion des `role_assignment` existants (table ensuite supprimée) :
  - `rh_admin` → portée *tout* + toutes les permissions ;
  - `lecteur_global` → portée *tout* + noms + CA/marge ;
  - `lecteur_perimetre` → portée = son périmètre (+ noms si `nominatif`).
  - `fonction` reprise du rôle (« Administrateur RH », « Lecteur global »…) puis corrigée à la main.

### Permissions (libellés de l'écran → actions du code)
| Permission | Actions | Condition |
|---|---|---|
| *Consulter les rapports* | `report:read`, `perimetre:read` | Toujours accordée, non décochable ; limitée à la portée |
| Voir les noms et fiches individuelles | `nominatif:read` | — |
| Voir le CA et la marge | `marge:read` | Portée *tout* exigée (le CA est global) |
| Importer la paie | `import:read`, `import:write` | Portée *tout* exigée |
| Corriger les données, saisir budgets et CA | `saisie:write`, `periode:write`, `report:write` | Portée *tout* exigée (D2) |
| Gérer les listes de valeurs, règles et périmètres | `referentiel:write`, `perimetre:write` | Portée *tout* exigée |
| Gérer les comptes et les droits | `users:read`, `users:write` | Portée *tout* ; garde-fous du §3 |
| Consulter le journal | `audit:read` | Portée *tout* exigée (le journal montre CA, budgets, noms et comptes de tous les services) |

Le catalogue est figé dans le code (`security/policy.py`) ; seule son attribution est en base.

### Filtre des données
`scope_for` lit la portée du compte : *tout* → aucun filtre ; sinon services = services accordés + services des périmètres accordés, idem pour les sites. Combinaison proposée : **ET entre service et site, OU à l'intérieur** (« Commerce VN » + « site de Douala » = Commerce VN à Douala). Aujourd'hui c'est OU partout ; aucun compte existant n'est touché (tous les périmètres sont par service). Aucune portée = aucune donnée.

### Écran (sans modale)
Page Utilisateurs en **liste + fiche** : la liste à gauche (nom, fonction, résumé « Tout / DPS / 2 services »), la fiche du compte sélectionné à droite, éditée en place :
1. Identité : nom, adresse, fonction, actif.
2. Données visibles : case « Toutes les données », sinon cases des périmètres, puis services et sites (repliables).
3. Permissions : une case par ligne avec une phrase d'explication ; les cases qui exigent *tout* sont grisées avec la raison.
4. Barre « Enregistrer / Annuler » visible dès qu'un champ change (pas d'enregistrement case par case : un seul événement d'audit, pas d'état intermédiaire incohérent).
Création : bouton « Nouveau compte » qui ouvre une fiche vide dans le même panneau, avec un choix de modèle (Administrateur RH, Lecteur global, Directeur de périmètre) qui pré-coche.

## 6. Impacts et risques
- **Sécurité** : changement du cœur des droits. Tests pytest par permission et par portée ; test de non-régression qui vérifie que les 10 comptes de recette gardent exactement les mêmes accès après migration. Revue `/code-review` obligatoire.
- **API** : les ~60 `authorize` ne bougent pas. Changent : `Principal`, `policy.py`, `scope.py`, `deps.py`, `/auth/me` (fonction au lieu de rôles), `/api/v1/users` (corps `fonction`, `permissions`, `portee`).
- **Front** : page Utilisateurs refaite, `lib/roles.ts` remplacé par le catalogue des permissions, badge de l'en-tête = fonction.
- **Recette** : `comptes.csv` (colonnes `fonction;portee;permissions`), `reinit.py`, e2e 40 et 60.
- **Performance** : une ou deux petites requêtes de plus à la connexion, négligeable.
- **Démo du 21/10** : travail sur une nouvelle branche ; `page-utilisateurs` et `recette.db` restent intacts pour la présentation.

## 7. Décisions (2026-10-20)
1. « IO » = lecture / écriture : c'est l'axe des permissions (§5), pas une donnée de plus. Portée sur services, sites et périmètres.
2. Service + site accordés ensemble : **ET** (seulement ce service sur ce site), OU à l'intérieur d'une même dimension.
3. Écriture (import, corrections, listes de valeurs, comptes) réservée à une portée *tout*.
4. « Gérer les comptes et les droits » : les deux administrateurs RH, comme aujourd'hui.
5. Une barre « Enregistrer / Annuler » par fiche.
