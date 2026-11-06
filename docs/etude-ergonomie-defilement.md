# Étude : ergonomie du défilement (point 25-g)

## Besoin
Sur Mensuel, Annuel et Graphiques (sections plein écran avec accrochage) :
- aucun tableau ne défile dans son cadre ;
- c'est la section qui défile verticalement quand son contenu dépasse l'écran ;
- tableaux et graphiques gardent une taille minimale (jamais écrasés) ;
- l'accrochage section par section est gardé.

## Existant
- `components/SnapSections.tsx` : sections à hauteur d'écran, molette « un geste = une section », sauf si le tableau survolé (`.panneau-corps`) peut encore défiler.
- `lib/plafond.ts` : étire un tableau jusqu'à `--ligne-max` ; s'il ne tient pas, le borne à la section, et il défile dans son cadre.
- `styles/base.css` : `.panneau-corps` en `overflow-y: auto` dans les sections, panneaux bornés à `max-height: 100%`, tableaux empilés autorisés à rétrécir (`flex-shrink: 1`, `min-height: 0`), graphiques sans hauteur minimale.
- Sous 1360 px (sans accrochage) : le tableau à ligne de total figée défile aussi dans son cadre.

## Options
| Option | Pour | Contre |
|---|---|---|
| A. La section défile en elle-même (hauteur d'écran, `overflow-y: auto`) | Accrochage inchangé ; la molette garde sa logique (on remplace le tableau par la section) ; en-têtes figés restent visibles en haut de la section | Deux niveaux de défilement (section puis page de sections) |
| B. Section à hauteur libre (`min-height: 100%`) dans le défilement global | Un seul niveau | Accrochage obligatoire peu fiable sur une section plus haute que l'écran ; molette à réécrire ; totaux figés perdus |

## Choix : A
- Tableaux à hauteur naturelle : cadre sans défilement, panneaux non bornés, tableaux empilés jamais rétrécis.
- Étirement gardé : s'il reste de la place, les lignes s'étirent jusqu'à `--ligne-max` comme avant ; sinon hauteur naturelle et la section défile.
- Graphiques : hauteur minimale (11rem par zone de tracé), la section défile en dessous.
- Molette : défilement libre dans la section (pas d'accrochage à l'intérieur). Au bout de la section, le geste s'arrête : il faut relâcher (pause de 200 ms) puis relancer pour changer de section. Un geste lancé au bout mène à la section voisine en une fois ; la fin de ce geste (inertie) ne fait pas défiler la section d'arrivée. En remontant, on arrive en bas de la section précédente.
- Suite signalée par une flèche animée sous les points du rail (contenu plus bas, section suivante, ou retour en haut) ; cliquable. Le bouton texte sous les tableaux est retiré : la place est rendue aux tableaux.
- Seul l'en-tête de tableau reste figé (par rapport à la section). La ligne de total suit le contenu : figée, elle masquait les lignes du dessous (retour utilisateur). Figer aussi les lignes CA / marge / effectifs de chaque tableau a été écarté : trop de hauteur prise, et on aurait l'impression que le tableau défile. DONNEES garde son total figé.
- Hauteurs minimales : ligne 28 px, en-tête 32 px (repère Carbon d'IBM : compact 24, court 32, standard 40) ; étirement plafonné à 36 px. Plus de compression selon la hauteur d'écran : la section défile.
- Graphiques : le titre du groupe affiché est placé sur la ligne du menu des groupes et suit la section visible.
- Sous 1360 px : plus de cadre défilant pour le tableau à total, la page défile.

## Non touché
- Défilement horizontal des tableaux sur mobile (colonne figée, décision de la refonte UI) : nécessaire à 390 px.
- DONNEES, saisie, admin, Individuel, Résumé : grilles de travail ou écran unique déjà calé ; hors du sujet « sections ».
- Rapport PDF : sections à hauteur libre, sans défilement.

## Risques
- Section qui défile dans une zone qui défile : vérifié à la molette, au rail et au clavier (Playwright).
- Pas de donnée, pas de sécurité, pas de migration.
