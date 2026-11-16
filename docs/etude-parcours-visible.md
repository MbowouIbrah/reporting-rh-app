# Étude : parcours complet visible (présentation des retours N2)

## Besoin
Un script qui rejoue l'appli du site de présentation (8090) **dans une fenêtre visible, au premier plan, au rythme d'un vrai utilisateur** : pauses, défilement, surlignage de ce qui est montré. Il suit le parcours dans l'ordre du menu et montre chaque retour N2 (1 à 10). Il sert aussi de passe de test : il note les débordements, lenteurs et manques de clarté.

## Existant
- Recette Playwright `frontend/e2e-recette/*.spec.ts` : sans fenêtre, sur une base SQLite réinitialisée (ports 8100/5180), pas sur 8090.
- Modèle retenu : `Academy Assist/scripts/parcours.ts` (aucun parcours visible dans cfaoacademy lui-même) : scénario réel, changement de compte, étapes numérotées, Chrome du poste.
- Comptes : `tools/recette/comptes.local.csv` (non suivi). Le site 8090 a les comptes du worktree `c:/tmp/rh-presentation` (dont `dop.equipment`).
- Chromium de Playwright non installé (pas d'installation) : on lance Chrome ou Edge du poste.

## Ce que fait un vrai testeur (synthèse des pratiques courantes)
1. Parcours nominal dans l'ordre du menu, avec chaque profil (admin, lecteur global, lecteur à périmètre).
2. États particuliers : vide (filtre sans résultat), erreur (lien invalide), chargement.
3. Mise en page : débordement horizontal, textes qui se chevauchent ou sont coupés, à plusieurs largeurs (bureau 1440, portable 1280, téléphone 390).
4. Fluidité : temps d'affichage de chaque écran (seuil 3 s), défilement.
5. Clarté : chaque action a un libellé compréhensible, chaque bouton désactivé dit pourquoi.

## Options
| Option | Pour | Contre |
|---|---|---|
| Spec `@playwright/test` en mode `--headed` | Outils de test, rapport | Pensé pour vérifier, pas pour montrer ; délais et fenêtre maximisée peu naturels |
| **Script Node autonome (choisi)** | Même forme que le modèle ; fenêtre maximisée, `slowMo`, bandeau et surlignage injectés ; tourne sur 8090 tel quel | Pas de rapport Playwright (on écrit le nôtre) |

## Choix
`tools/recette/parcours-n2.mjs`, lancé depuis `frontend/` (`node ../tools/recette/parcours-n2.mjs`).
- **Lecture seule** : rien n'est enregistré sur 8090 (pas de lien généré, pas de décision appliquée, pas d'import).
- Bandeau en bas de page « Retour N2 n° x : … » + cadre rouge autour de l'élément montré.
- Contrôles automatiques à chaque écran : débordement horizontal, textes qui se chevauchent, temps d'affichage.
- Sorties dans `c:/tmp/parcours-n2/` : `rapport.md` (checklist cochée + constats) et une capture par étape.
- Options : `--vite` (pauses courtes), `--sans-fenetre` (contrôle rapide), `PARCOURS_URL`, `PARCOURS_COMPTES`.

## Risques
- Données 8090 changées entre deux passages : le script cherche par libellé, et passe une étape absente en la notant.
- Comptes réels de la base de recette : script local, rien n'est publié.

## Résultat (16/11)
- Lancer : `cd frontend && PARCOURS_COMPTES=<chemin comptes.local.csv> node ../tools/recette/parcours-n2.mjs` (fenêtre visible) ; `--sans-fenetre --vite` pour un contrôle rapide.
- 41 points contrôlés (retours N2 1 à 10, 2 comptes, 3 largeurs).
- Corrigé : libellés de filtres qui se chevauchaient à 1360-1440 px (`.souple`) ; chiffres superposés du tableau des charges au téléphone (le tableau défile dans son cadre) ; en-tête « Année » coupé dans Administration des données.
- Noté : Mensuel du DOP Equipment à 3 s (limite) ; N2-5 non montrable sans compte au statut « Provisoire » sur 8090.
