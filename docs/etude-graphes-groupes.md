# Étude : graphiques affichés par groupes (page Graphes)

## Besoin
20 graphiques possibles sur une page faite pour 4 (grille 2 × 2 à la hauteur de l'écran) : au-delà, les cartes se chevauchent. Demande : afficher par **groupes de 4** graphiques qui vont ensemble, avec trois façons de voir :
1. **Un groupe** (par défaut) : le menu liste les groupes (nom, et en gris les graphiques qu'il contient).
2. **Tout afficher** : chaque groupe dans sa section plein écran, avec accrochage au défilement et rail à droite, comme Mensuel et Annuel.
3. **Personnaliser** : créer ses groupes, choisir les groupes affichés et leur ordre, choisir ce qui s'ouvre en premier (un groupe, ou « Tout afficher »).

## Existant
- `pages/Graphes.tsx` : catalogue `GRAPHES` (20 graphiques, ceux sans donnée sont retirés), tous rendus dans une seule grille.
- `components/ChoixGraphes.tsx` + `lib/choixGraphes.ts` : cases à cocher par graphique, choix gardé sur le serveur (`/auth/preferences/graphes.<page>`, B-021) avec copie dans le navigateur.
- `components/SnapSections.tsx` : sections plein écran, accrochage, rail (Mensuel, Annuel), conçu pour des tableaux.
- `components/Kit.tsx` : modale native `<dialog>`.

## Options
| Option | Pour | Contre |
|---|---|---|
| A. Groupes remplacent les cases par graphique ; réglage gardé sur le serveur sous une nouvelle clé `groupes.<page>` | Un seul réglage, clair ; suit l'utilisateur sur tous les postes | Le choix de graphiques masqués d'avant n'est pas repris |
| B. Garder les cases en plus des groupes | Rien de perdu | Deux réglages qui se contredisent (graphique masqué dans un groupe) |
| C. Pagination simple par 4 dans l'ordre du catalogue | Très simple | Groupes sans logique, pas de personnalisation |

**Choix : A.** La personnalisation couvre le besoin des cases (un groupe perso = les graphiques que je veux voir).

## Groupes d'origine (4 graphiques chacun, d'après les familles du calcul)
| Groupe | Graphiques |
|---|---|
| Effectif et masse salariale | Masse salariale, Rémunération globale, Effectif, Absences |
| Salaires, primes et charges | Salaire, Primes, Assurance, Formation |
| Frais et avantages | Frais de mission, Logement site déporté, Crédit téléphonique, Carburant |
| Ventes, marge et commissions | CA, Marge, Commissions, Ventes |
| Atelier et productivité | Clients, Factures, Productivité, OR par productif |

Un graphique sans donnée (droit marge absent, activité non importée) est retiré de son groupe ; un groupe vide n'est pas proposé.

## Décisions prises par défaut
- Réglage : `{ perso: [{id, nom, graphes ≤ 4}], ordre: [ids des groupes affichés], defaut: id | "tout" }`, validé par le serveur (20 groupes perso au plus, nom ≤ 60 caractères). Groupe d'origine absent de `ordre` = masqué ; on peut donc n'afficher que ses groupes perso.
- Le groupe choisi dans le menu vaut pour la visite ; à l'ouverture, la page montre le réglage « par défaut ».
- Personnaliser : fenêtre avec copie de travail (Enregistrer / Annuler), « Rétablir les groupes d'origine ».
- Export PDF : tous les groupes affichés, dans l'ordre choisi, un groupe par page.
- Noms des groupes d'origine : un administrateur (droit `referentiel:write`) peut les renommer dans « Personnaliser » ; le nom choisi est gardé sur le serveur (`/reglages/noms_groupes`) et vu par tous. Champ vide = nom par défaut. Les groupes personnels gardent leur nom.
- Les autres utilisateurs peuvent aussi les renommer, pour eux seuls : noms personnels dans leur réglage `groupes.<page>` (champ `noms`), prioritaires sur les noms communs. Le serveur refuse toujours le `PUT /reglages/noms_groupes` sans `referentiel:write`.
- Ancien choix « graphiques masqués » (clé `graphes.evolution`) : n'est plus lu ; la route serveur reste.

## Impacts / risques
- Pas de migration (même table `preference_utilisateur`, colonne JSON). Serveur : schéma de la nouvelle clé + tests.
- Risque : un id de graphique renommé plus tard dans un groupe perso → ignoré à l'affichage (pas d'erreur).
