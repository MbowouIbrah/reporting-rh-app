# Design : Reporting RH

Dérivé de ce qui est livré (refonte R1 à R4). Source des valeurs : `src/styles/tokens.css`.

## Principes
- Le chiffre est le héros : tuiles KPI en grand, chiffres tabulaires, montants alignés à droite, unité FCFA unique.
- Sobre : le marine structure, le rouge CFAO est réservé à l'action et aux alertes, beaucoup d'espace blanc.
- Jamais la couleur seule : variation = flèche + signe + texte (`Variation`), état = texte + badge.
- Un montant absent s'affiche « — » avec explication quand elle existe ; « n/a » pour une division par zéro.

## Tokens
- Identité : `--red`, `--navy`, `--ink`, `--paper*`, `--rule`, `--muted`.
- Sémantique : `--success|warning|error|info` et variantes `-soft`.
- Données (graphes) : `--data-1..6` (bleu, sarcelle, orange, violet, vert, gris), >= 3:1 sur blanc.
- Échelles : espacement `--sp-1..7` (4 à 48), rayons, ombres `--shadow-1..3`, z-index, durées, typo fluide `--fs-*` (KPI : `--fs-kpi`), graisses 400/500/600.
- Typographie : toute taille passe par un token `--fs-*`, jamais de px en dur ni de taille indexée sur la hauteur d'écran ; plancher 12 px. Rôles : `xs` 12 libellés, en-têtes de colonnes, notes ; `sm` 13 cellules de tableaux, texte secondaire ; `md` 14 texte courant (corps), contrôles, navigation, titres de panneaux ; `base` 16 titres de section ; `lg` titres de bandeau ; `xl` valeurs de tuiles ; `2xl` titres de page. Champs à 16 px sous 720 px (pas de zoom iOS).
- Grille : `--page-max` 1280 px, marges `--page-gutter` fluides.

## Composants (`src/components/`)
- `Layout` : en-tête compact, onglets, rôle visible, menu replié sous 720 px.
- `FiltresPeriode` : barre collante, puces de résumé, réinitialisation.
- `Tuile` (+ `Variation`) : héros optionnel, absence expliquée.
- `Kit` : `Badge`, `Bouton` (primaire, secondaire, lien), `Carte`, `Section` (repliable, `<details>`).
- `Etat` : squelette de chargement, vide, 404, 403 distinct, erreur avec « Réessayer ».
- `Lignes` : lignes M-1 | M | variation | % (+ budget). Tableaux `table.dense` : en-têtes et libellés figés, totaux, groupes, lignes exclues en italique, défilement interne.

## Accessibilité et impression
- Focus visible, `prefers-reduced-motion`, axe (wcag2a/aa/21aa) sans violation sur les 6 pages (`e2e/axe.mjs`).
- Graphes : texte alternatif et tableau de données repliable.
- Impression : barre, filtres et boutons masqués, en-têtes de tableau répétés.

## Hors périmètre
Mode sombre (non fait), Lighthouse (non installé, disque C: serré).
