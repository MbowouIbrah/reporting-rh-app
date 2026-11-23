# Étude : départements (E7)

Date : 13/11/2026. Étape 2 du plan § 10 de `etude-import-automatique.md`. Décision client : `QUESTIONS_CLIENT.md` E7, D6.

## 1. Besoin
- Les départements (BU) deviennent une liste de valeurs gérée dans l'appli : ajout, renommage, désactivation.
- Chaque service appartient à un département. Au départ : **Equipment** (tous les services déjà présents) et **Winpart** (services Winpart, Motul, Autofast). Motors viendra plus tard (ajouté par l'admin).
- Winpart est à la fois un département et un service.
- L'export de paie porte une colonne « Intitulé département ».
- D6 : l'autre DOP voit Equipment + Winpart, puis Motors plus tard. Il faut donc pouvoir accorder un département.

## 2. Existant
| Élément | Où | Utile pour |
|---|---|---|
| Listes de valeurs `_Ref` (libellé unique, actif) | `models/referentiel.py` | Le département est une `_Ref` de plus |
| Poste rattaché à une activité (`activite_id`, liste déroulante) | `Poste`, `api/periodes.py`, `pages/admin/Referentiels.tsx` | Même modèle pour service → département |
| Alias d'import, renommage propagé aux droits | `RefAlias`, `PUT /referentiels/{dim}/{id}` | Renommer un département sans casser l'import ni les droits |
| Droits : portée par service, site ou périmètre | `UtilisateurPortee`, `security/policy.py` `Portee`, `repos/scope.py` `scope_for` | Ajouter « département » sans toucher au filtre SQL |
| Import CSV de paie | `imports/paie.py` (colonne département lue nulle part) | Rattacher un service créé par l'import |

## 3. Options pour les droits
| Option | Pour | Contre |
|---|---|---|
| A. Accorder la liste des services du département | Rien à changer côté droits | Motors ajouté plus tard : il faut refaire chaque compte |
| **B. Accorder le département ; à la lecture, il vaut ses services** | Un service ajouté ou rattaché au département est vu tout de suite ; filtre SQL inchangé (`apply_scope` reçoit des services) | Une table de plus à lire au calcul du périmètre (négligeable) |
| C. Colonne département sur chaque donnée | Filtre direct | Migration lourde, données en double, change si un service change de département |

**Choix : B.** `scope_for` ajoute aux services accordés ceux des départements accordés. Le filtre reste dans la couche dépôt.

## 4. Décisions
1. Table `departement` (`_Ref`) ; `service.departement_id` facultatif (un service peut rester « non rattaché », signalé dans l'admin).
2. Migration 0028 : crée Equipment et Winpart, rattache Winpart / Motul / Autofast (comparaison sans accents ni casse) à Winpart, les autres services à Equipment. Motors n'est pas créé.
3. Admin, Listes de valeurs : onglet Départements (ajout, renommage, activer / désactiver) ; sur chaque service, liste déroulante du département.
4. Renommer un département : l'ancien nom reste reconnu à l'import (alias) et les droits accordés sont renommés, comme pour un service.
5. Droits : un compte peut recevoir des départements (fiche du compte). Un département désactivé reste accordé (comme un service désactivé).
6. Import CSV : un service **créé** par l'import est rattaché au département de la colonne « Intitulé département » si ce département est connu (nom ou alias). Un service déjà connu garde son département : l'appli fait foi. Département inconnu : service non rattaché ; le bouton « Ajouter / Rattacher » viendra à l'étape 7 du plan. Import Excel : inchangé.
7. Filtre et regroupement par département dans les tableaux : pas dans cette étape (aucun écran ne le demande encore) → `backlog.md`.

## 5. Impacts et risques
- Données : une table, une colonne, migration réversible. Aucune donnée importée ne change.
- Sécurité : la portée par département élargit un droit ; seuls les comptes avec `users:write` l'accordent (même règle que service / site).
- Risque : un service changé de département change ce que voit un compte accordé par département. C'est voulu (la liste de l'appli fait foi).

## 6. Plan
1. Modèle + migration 0028 + données de départ (`referentiels_init.py`, `seed.py`, `reinit.py --demo`).
2. API listes de valeurs : dimension `departement`, `departement_id` du service, alias et renommage.
3. Droits : portée `departement`, `scope_for`, API des comptes.
4. Import CSV : rattachement d'un service créé.
5. Écrans admin : onglet Départements, département du service, départements d'un compte.
6. Tests (pytest, vitest), ruff, build.
