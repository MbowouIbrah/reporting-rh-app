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

### Proposition (présentation seulement, aucun chiffre, règle ni libellé changé)
Les 6 libellés « Évolution par rapport à … » restent tels quels (décision du 21/10 : ils doivent rester clairs et précis).
1. **Hiérarchie** : titre en petit texte normal (plus de capitales grasses), valeur en `--fs-xl` ; le libellé d'évolution et sa valeur gardent leur texte mais passent en `--fs-sm` couleur atténuée, la flèche colorée seule porte le sens. Marge intérieure portée à `--sp-3`/`--sp-4`.
2. **Notes** : la phrase CA/marge (Q3) reste, en une ligne discrète sans fond gris ; la note du suivi mensuel passe dans une info-bulle « ⓘ » à côté du titre.
3. **Tableau** : garder la teinte crème des cellules saisies, retirer le zébrage (une seule information visuelle par cellule).

### Autres pages
- Mensuel et Annuel : la grille dense est voulue (« tout visible sans défilement », comme les onglets Excel). Seules les retouches 2 et 4 (hiérarchie, une seule teinte) s'appliquent, sans changer la disposition.
- Graphes, Individuel : à revoir après le Résumé, avec la même grille de lecture.

## 2. Mouvement : état des lieux et écarts réels

La première version de cette section affirmait « rien au changement de page ni à l'arrivée des données » : c'était faux. Inventaire vérifié dans `styles/base.css` et les pages :

| Moment | Ce qui existe | Écart réel ? |
|---|---|---|
| Changement de page | Fondu d'apparition 0,3 s du contenu (`base.css:889-892`, `.page > *`), rejoué à chaque page car le contenu est remonté | **Partiel** : la page quittée disparaît d'un coup (pas de fondu de sortie), d'où l'effet de coupure ; le fondu n'utilise pas les jetons |
| Premier chargement | Squelettes à reflet (`base.css:1002-1028`), affichés après 0,3 s seulement (pas de clignotement si la réponse est rapide) | Non |
| Changement de filtre | `aria-busy` pendant le recalcul (Résumé, Mensuel, Annuel, Individuel) : mêmes squelettes après 0,3 s ; la classe `maj` n'a aucun style | Non pour le signal. **Petit** : le retour squelette → chiffres est sec |
| Survol, focus, boutons, onglets | Transitions de couleur (`base.css:117, 825-861`), jetons `--dur`/`--ease` sur 10 règles | Non |
| Rail de défilement, volets, flèche des sections | Fondus et glissements (`base.css:134, 399-409, 722`) | Non |
| Bulle de détail d'une case du Résumé | `display: none` → `grid` (`base.css:304-305`) | **Oui** : apparition sèche, alors que la bulle du rail est en fondu |
| Menu profil | Rendu conditionnel `ouvert && …` (`MenuProfil.tsx:47`) | **Oui** : apparition sèche |
| Réduction du mouvement | Coupure globale (`base.css:17-19`) + squelettes figés | Non |
| Cohérence | 14 durées codées en dur (0,15 à 0,7 s, 4 courbes différentes) à côté des jetons | **Oui**, mineur : rythme inégal |

Conclusion : l'impression « aucune animation » ne correspond pas au code ; l'impression « brusque » a deux causes concrètes : la sortie de page instantanée et les deux bulles/menus qui surgissent.

### Améliorations ciblées (seulement sur les écarts ci-dessus)
1. **Sortie de page** : `viewTransition` sur les `NavLink` de `Layout.tsx` (React Router 7, API View Transitions) → fondu croisé de 200 ms entre l'ancienne et la nouvelle page ; la barre du haut reste fixe. Navigateur sans l'API : comportement actuel inchangé. Le fondu d'apparition actuel passe sur `--dur`/`--ease`.
2. **Bulle du Résumé et menu profil** : fondu de `--dur-fast` (120 ms), comme la bulle du rail.
3. **Retour des chiffres après squelette** : fondu de 120 ms à la fin de `aria-busy`.
4. **Durées** : les transitions codées en dur passent sur les jetons quand elles jouent le même rôle (survol, apparition) ; les animations à rythme propre (reflet des squelettes, rebond d'indice) restent.
- Écarté : estomper le contenu pendant un changement de filtre (le squelette le signale déjà) ; bibliothèque d'animation (+35 Ko) ; tout effet décoratif.
- Coût : environ 30 lignes de CSS, 2 fichiers TSX, sans dépendance.

## 3. Décisions (21/10)
- §1 et §2 validés. Demande ajoutée : apparition plus marquée que le simple fondu, réglée à un seul endroit et facile à changer pour comparer.
- **Résumé** : titres en casse normale (même texte), valeur `--fs-xl`, marges `--sp-3`/`--sp-4`, évolution atténuée (flèche seule colorée : rouge en baisse) ; sur la grille ≥ 900 px la ligne secondaire reste en `--fs-xs` pour que « Évolution par rapport à Juin 2025 » tienne entier. Note du suivi mensuel dans une info-bulle « i » (survol, focus ou toucher) ; tableau sans zébrage.
- **Mensuel / Annuel** : rien à changer, la ligne Total est déjà en gras sur une seule teinte ; le zébrage reste (tableaux larges et denses).

### Mouvement centralisé
- `frontend/src/styles/mouvement.css` : seul fichier des animations d'apparition. Réglages en tête (`--mv-dur-page`, `--mv-decalage`, `--mv-distance`, courbes), puis un préréglage par effet.
- Effets : `monte` (défaut : glisse de 14 px vers le haut, blocs de la page décalés de 55 ms), `fondu`, `glisse` (latéral), `zoom`, `aucun`.
- Essayer un effet : ajouter `?mouvement=zoom` à l'adresse (mémorisé dans ce navigateur), `?mouvement=defaut` pour revenir. Changer pour tout le monde : `EFFET_PAR_DEFAUT` dans `frontend/src/lib/mouvement.ts`.
- Ajouter un effet : une paire de `@keyframes`, une ligne `[data-mouvement]`, le nom dans `EFFETS`.
- Sortie de page : `LienPage.tsx` (barre du haut) appelle `transitionPage` → View Transitions, la page quittée s'efface en 180 ms. Navigateur sans l'API, mouvement réduit ou effet `aucun` : navigation directe.
- Surgissent avec l'effet : bulle des cases, info-bulle, menu profil, ligne de fichier de l'import. Les chiffres reviennent en fondu à la fin d'un squelette.
- Un bloc qui contient le rail fixe n'est animé qu'en fondu (un transform décalerait le rail pendant l'animation).
- `prefers-reduced-motion` : tout est coupé.
