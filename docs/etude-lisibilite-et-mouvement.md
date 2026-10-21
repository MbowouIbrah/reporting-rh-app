# Étude : lisibilité du Résumé et mouvement de navigation (2026-10-21)

## 1. Résumé : page jugée touffue

### Constat (code et styles actuels)
- 8 cases sur 2 rangées (`Resume.tsx`, disposition du 16/10). Chaque case empile 4 textes : titre en capitales grasses, valeur, libellé secondaire, valeur secondaire.
- « Évolution par rapport à 2025 » est répété 6 fois ; tout le texte secondaire est en `--fs-xs` gris : beaucoup de petits textes de même poids, sans hiérarchie.
- Cases serrées : marge intérieure de 6 × 10 px (`base.css:293`), valeur en `--fs-lg` seulement : le chiffre ne domine pas.
- Deux phrases d'explication en italique sur fond gris (`.regle`) : la note CA/marge sous les cases et celle du suivi mensuel. Elles s'ajoutent au bruit.
- Tableau de suivi : zébrage, cellules crème des saisies et pointillés se cumulent.

### Contraintes à respecter
- Ordre et contenu des 8 indicateurs (16/10), bulles de détail au survol, masquage de CA/marge/CA par salarié avec une phrase d'explication quand un filtre est actif (Q3), chiffres exacts sans arrondi dans les bulles, angles droits.

### Proposition (présentation seulement, aucun chiffre ni règle changé)
1. **Un seul libellé de comparaison** au-dessus des cases (« Évolutions : cumul 2026 comparé à 2025 ») ; dans chaque case, l'évolution devient une ligne courte « ▲ 4,2 % » colorée. Le texte répété passe de 6 occurrences à 1.
2. **Hiérarchie** : titre en petit texte normal (plus de capitales grasses), valeur en `--fs-xl`, une seule ligne secondaire. Marge intérieure portée à `--sp-3`/`--sp-4`.
3. **Notes** : la phrase CA/marge (Q3) reste, mais en une ligne discrète sans fond ; la note du suivi mensuel passe dans une info-bulle « ⓘ » à côté du titre.
4. **Tableau** : garder la teinte crème des cellules saisies, retirer le zébrage (une seule information visuelle par cellule).

### Autres pages
- Mensuel et Annuel : la grille dense est voulue (« tout visible sans défilement », comme les onglets Excel). Seules les retouches 2 et 4 (hiérarchie, une seule teinte) s'appliquent, sans changer la disposition.
- Graphes, Individuel : à revoir après le Résumé, avec la même grille de lecture.

## 2. Mouvement : navigation brusque

### Constat
- Jetons déjà présents : `--dur-fast` 120 ms, `--dur` 200 ms, `--ease` ; `prefers-reduced-motion` déjà respecté par endroits. Il n'y a que des transitions de survol : rien au changement de page, à l'arrivée des données ou à l'ouverture des bulles.
- React Router 7 : `NavLink` accepte `viewTransition`, qui s'appuie sur l'API View Transitions du navigateur.

### Options
| Option | Pour | Contre |
|---|---|---|
| A. API View Transitions (`viewTransition` sur les liens) | Natif, 0 Ko ajouté, fondu entre pages, barre du haut fixe | Firefox récent seulement ; ailleurs, changement instantané comme aujourd'hui |
| B. Animation CSS à l'arrivée du contenu de page (`key` sur l'`Outlet`) | Partout, simple | Pas de fondu de sortie |
| C. Bibliothèque (motion) | Riche | +35 Ko, trop pour un outil de gestion |

### Recommandation : A + B légère, sobre et professionnelle
- Changement de page : fondu de 200 ms (A) ; en repli, le contenu monte de 4 px en fondu (B). La barre du haut et les filtres restent fixes.
- Arrivée des données : fondu des cases et des tableaux (150 ms), sans cascade longue.
- Changement de filtre : l'ancien contenu reste affiché (déjà le cas avec `keepPreviousData`), légèrement estompé pendant le chargement, ce qui signale le calcul sans clignotement.
- Bulles et menus : fondu de 120 ms au lieu d'une apparition sèche.
- Tout passe par les jetons `--dur`/`--ease` et est coupé avec `prefers-reduced-motion`. Aucun rebond, aucun effet décoratif.
- Coût : environ 60 lignes de CSS et 3 fichiers TSX, sans dépendance ajoutée.

## 3. Points à trancher
- Retirer les 6 libellés « Évolution par rapport à … » au profit d'un libellé unique : accord du client nécessaire si ce libellé avait été demandé le 16/10.
- Valider la recommandation sur le mouvement (A + B).
