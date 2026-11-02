# Revue : salaire, primes et choix des graphiques (demandes 8 et 12)

Branche `salaire-primes-graphiques`. Passe 1 : audit complet du diff. Passe 2 : contre-revue ciblée.

| N° | Fichier | Classe | Correction | Statut |
|---|---|---|---|---|
| 1 | `backend/app/kpi/moteur.py` (`_part`, annuel et colonne N-1 du mensuel) | Exclusion lue sur une autre période que le montant | Chaque montant est classé compté / hors total selon les exclusions de son propre mois ; le TOTAL N-1 égale `synthese.ms.m1` | corrigé (test `test_familles_exclusion_changeant_en_cours_d_annee_et_budget_partiel`) |
| 2 | `backend/app/kpi/moteur.py` (`_familles`) | Budget de famille calculé sur une partie des rubriques | Budget de famille vide (et écart vide) dès qu'une rubrique comptée avec montant n'a pas de budget | corrigé (même test ; passe 2 : cas annuel d'une rubrique sans budget comptée un mois puis exclue, budget lu sur les montants comptés) |
| 3 | `frontend/src/lib/choixGraphes.ts` | Choix d'affichage partagé entre utilisateurs d'un même navigateur | Clé `reporting-rh.graphes.<id utilisateur>.<page>` ; relue si l'utilisateur change ; suit l'événement `storage` (autre onglet) | corrigé (Vitest `Pages.test.tsx`, `choixGraphes.test.ts` : changement d'utilisateur et autre onglet) |
| 4 | `backend/tests/test_rapports_api.py` | Règle sans test d'API | Test des familles exposées : somme = TOTAL, montants en chaînes, filtre de périmètre (VN < global), mensuel et annuel | corrigé |
| 5 | `frontend/src/pages/Graphes.tsx` | Commande interactive dans le PDF | Bouton « Tout afficher » du message « Aucun graphique choisi » caché sur `/rapport` | corrigé |
| 6 | `frontend/src/components/ChoixGraphes.tsx` | Menu déroulant sans fermeture clavier ni clic à côté | Fermeture par Échap (focus rendu au bouton) et par clic hors du menu | corrigé (Vitest `ChoixGraphes.test.tsx`) |
| 7 | `frontend/.gitignore` | Fichier de travail committable | `/*.png` ignoré (dont `site.png`) | corrigé |
| 8 | `xlsx.py`, `BlocsRapport.tsx`, `moteur.py` | Libellés des familles écrits trois fois | — | différé : petite duplication, à regrouper si les familles deviennent modifiables (B-020) |
| 9 | `backend/app/exports/xlsx.py` | Sous-totaux de famille et feuille « Charges exclues » absents de l'Excel | — | différé : Excel non exposé à l'écran (PDF seulement), suivi en B-022 (`backlog.md`) |
| 10 | `moteur.py` (synthèse, cumuls) | Champs `salaire` / `primes_toutes` calculés mais non affichés | — | rejeté : conforme au plan §6 (servent aux graphiques et aux exports) |
| 11 | Graphique salaire / sous-total famille salaire | Deux périmètres pour « salaire » | — | différé : question client F6 (`docs/QUESTIONS_CLIENT.md`) |
| 12 | `moteur.py` | Somme des budgets de familles ≠ budget du TOTAL CHARGES | — | différé : préexistant (budget du TOTAL saisi à part), noté ici |

## Passe 2 (contre-revue ciblée)

Écarts 1, 3 à 7 clos. Écart 2 rouvert sur l'annuel puis corrigé (voir ligne 2). Mineurs corrigés : tests du hook et du menu, paramètre `cle` de `lireMasques` / `ecrireMasques`, entrée B-022. Statuts 8 à 12 acceptés. Aucun écart restant.
