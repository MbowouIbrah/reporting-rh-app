# Étude : séparer salaire et primes (demande 8), choisir les graphiques (demande 12)

Le client n'a pas répondu à Q8.1, Q8.2, Q12.1 et Q12.2. Choix faits par défaut, à corriger après coup.

## 1. Existant
- `Rubrique` (`models/referentiel.py:72`) n'a pas de catégorie ; le « hors total » est une règle datée (`RubriqueRegle.regle='exclu_total_ligne'`). 17 rubriques posées par `referentiels_init.py:27`, l'admin peut en créer (`api/parametrage.py:87`).
- Brut Réel = Salaire brut garantie + Commission + Bonus + Primes sur ventes (contrôle d'import, `imports/regles.py:361`) : d'où les exclusions du total (règle B1).
- Moteur (`kpi/moteur.py`) : `a_type_charge` liste les rubriques avec `exclu` ; `PRIMES` (l.20) ne couvre que 3 primes ; `serie` (l.640) porte ms, commissions, primes, frais…
- Écran : `TypesCharge` puis tableau séparé `TypesExclus` (`BlocsRapport.tsx:95`, `:178`).
- Graphiques : 17 dans `pages/Graphes.tsx`, sans identifiant ni choix. Le PDF imprime la vraie page Graphes (`/rapport`, `window.print`).
- Préférences : aucune table ; `localStorage` déjà utilisé (`lib/mouvement.ts`).

## 2. Choix par défaut
- **Q8.1**, quatre familles dans le tableau des types de charge :
  - Salaire : Brut Réel ; Salaire brut garantie (hors total) ;
  - Primes : Bonus, Primes exceptionnelles ; Primes sur ventes, Primes sur résultats, Productivité Ateliers, Commission (hors total) ;
  - Avantages et frais : Frais de mission, Logement site déporté, Carburant véhicule service, Crédit téléphonique ;
  - Charges : Charges Patronales, Assurance Maladie, Formation, TVA & Marge MAD, et toute rubrique créée plus tard.
- **Q8.2** : les primes hors total sont montrées dans leur famille, marquées « hors total », non comptées (B1 inchangée). Le tableau séparé « Charges exclues du total » disparaît.
- Graphiques : « Salaire par mois » (Salaire brut garantie) et « Primes par mois » (les 6 primes).
- **Q12.1** : choix gardé dans le navigateur, par utilisateur (`localStorage`, clé `reporting-rh.graphes.<id>`, liste des graphiques masqués : un graphique nouveau apparaît d'office).
- **Q12.2** : le PDF ne contient que les graphiques choisis (il imprime la même page).

## 3. Options
| Sujet | Option | Pour | Contre |
|---|---|---|---|
| Familles | colonne `rubrique.famille` + migration + écran | l'admin corrige seul | migration, API, écran pour un classement non validé |
| Familles | **table dans `moteur.py`, défaut « charges »** | sans migration, facile à corriger | une rubrique créée tombe dans « Charges » |
| Choix graphiques | table de préférences serveur | suit l'utilisateur partout | migration, 2 routes, chargement avant impression |
| Choix graphiques | **`localStorage`** | rien côté serveur, PDF sans code de plus | un choix par navigateur |

Retenu : les options en gras. Les deux autres vont au backlog.

## 4. Impacts
- Sous-totaux par famille calculés par le serveur (`a_familles`), somme des sous-totaux = TOTAL CHARGES.
- Pas de migration. Le PDF Mensuel et Annuel perd une section (« Charges exclues ») : à relire.
- Identifiants des graphiques stables (les renommer perd les choix).

## 5. Risques et questions au client
- Bonus est dans le Brut Réel mais compté aussi à part : possible double compte (préexistant, non modifié).
- `remuneration_globale = ms + exclus` rajoute garanti, commission et primes sur ventes déjà dans le Brut Réel (préexistant, lien demande 13).
- À confirmer : le Brut Réel est-il du salaire ? Bonus et primes exceptionnelles sont-ils des primes ? Graphique salaire = garanti ou Brut Réel ? Choix des graphiques à suivre sur tous les postes ?

## 6. Plan d'implémentation
1. `kpi/moteur.py` après l.20 : `SALAIRE`, `PRIMES_TOUTES` (6 primes), `FAMILLES` (libellé → salaire/primes/avantages/charges), `ORDRE_FAMILLES`, `famille(r)` (défaut « charges »). Ne pas toucher `PRIMES`.
2. Lignes de `a_type` (mensuel l.351, annuel l.538) : `"famille": famille(r)` ; `None` sur TOTAL CHARGES.
3. `_familles(a_type)` : par famille présente, montant (lignes comptées seulement), m1, variations, budget (somme des budgets connus, sinon `None`), `hors_total` (lignes exclues) ; clé `a_familles` en mensuel et annuel.
4. `serie` : `salaire`, `primes_toutes` (`None` si mois vide) ; `synthese.salaire`, `synthese.primes_toutes` ; cumuls annuels.
5. `exports/xlsx.py:79` : colonne Famille.
6. `api/types.ts` : `famille`, `a_familles`, `salaire`, `primes_toutes` ; `Blocs` += `a_familles`.
7. `BlocsRapport.tsx` `TypesCharge` : titre de famille, rubriques (exclues en `tr.exclu` « (hors total) »), « Sous-total <famille> », puis TOTAL GÉNÉRAL inchangé ; repli sur l'affichage actuel sans `a_familles`. Retirer `TypesExclus` (+ appels `Mensuel.tsx:79`, `Annuel.tsx:33`). Styles `tr.famille`, `tr.sous-total` dans `base.css` (jetons, angles droits).
8. `Graphes.tsx` : graphiques « Salaire par mois » et « Primes par mois » après Rémunération.
9. `Graphes.tsx` : catalogue `GRAPHES` à identifiants stables, `visible(id) && …`, règles actuelles gardées (droit marge, activité sans données), message « Aucun graphique choisi ».
10. `lib/choixGraphes.ts` (modèle `mouvement.ts`, try/catch) + hook `useChoixGraphes()` ; `components/ChoixGraphes.tsx` : menu « Graphiques (n/N) », cases + « Tout afficher », sous les filtres, masqué dans `/rapport`.
11. Tests : pytest moteur (famille par ligne, rubrique inconnue → charges, somme des sous-totaux = TOTAL CHARGES, `hors_total` primes, série), API (`a_familles`, droit marge) ; Vitest BlocsRapport, `choixGraphes.test.ts`, Pages ; recette `e2e-recette/70-graphes.spec.ts` (masquer 2 graphiques, recharger, PDF avec les seuls graphiques cochés).
12. Docs : `DEMANDES_PRESENTATION_3.md` §8 §12 « Réalisé par défaut », `backlog.md` (famille modifiable, choix côté serveur), questions client (§5).
