# Étude : navigation et mise en page de l'administration

## Besoin (retours utilisateur du 21/10)
- Utilisateurs : la liste et la fiche défilent ensemble (c'est le conteneur qui défile). Chacune doit défiler seule et les deux colonnes doivent remplir la hauteur restante.
- Fiche, bloc Identité : un champ par ligne, bien équilibré.
- Même traitement pour l'écran « Référentiels », qui doit aussi changer de nom : le mot n'est pas compris.
- Ordre incohérent : le titre est au-dessus des onglets alors que ce sont les onglets qui le changent.
- Les onglets ont l'air de boutons, ce qui n'aide pas à comprendre qu'ils changent de section.

## Existant
- `AdminNav.tsx` : 4 liens (`NavLink`) filtrés par permission ; chaque page affiche son `h2` **puis** `AdminNav`.
- `base.css` : `.admin-onglets` dessine des boutons à bords arrondis (fond bleu marine pour l'onglet actif). `.comptes-duo` et `.admin-duo` sont des grilles en `overflow: auto` alignées en haut : c'est la grille qui défile, pas les panneaux.
- La mise en page plein écran (`.page-ecran` en colonne flex, hauteur 100 %) n'existe qu'à partir de 1360 px de large.

## Recherche (onglets)
- Les onglets se placent **au-dessus** du contenu qu'ils commandent ([NICE](https://design-system.nice.org.uk/components/tabs/), [Mesa](https://mesadesignsystem.lanl.gov/components/tabs/overview)).
- Ils doivent ressembler à des onglets et non à des boutons d'action : une barre continue, avec l'onglet actif bien marqué et relié au contenu ([WFP](https://designsystem.wfp.org/components/structure/tabs), [Justinmind](https://www.justinmind.com/blog/8-tips-to-get-tabs-right-in-web-design/)).
- Une phrase sous le titre explique à quoi sert la section : on comprend sans avoir à cliquer.

## Options
| Option | Pour | Contre |
|---|---|---|
| A. Garder les boutons, les déplacer au-dessus du titre | Peu de changement | Ont toujours l'air de boutons |
| B. Barre d'onglets soulignés au-dessus de l'en-tête (titre + description) | Repère connu, ordre logique, la description dit à quoi sert la section | Changement sur les 4 pages |
| C. Menu latéral | Supporte beaucoup de sections | Prend de la largeur, trop pour 4 sections |

**Choix : B.** `AdminNav` affiche la barre d'onglets, puis le titre et la description de l'onglet actif ; les pages ne gèrent plus leur titre. Le texte du titre ne change pas, donc les tests e2e restent valables.

## Nom de « Référentiels »
Le nouveau nom est « **Sites et services** », ce que l'écran contient vraiment. L'adresse `/admin/referentiels` reste la même, pour ne pas casser les liens et les tests.

## Défilement et hauteur
- Les grilles en deux colonnes prennent la hauteur restante (`flex: 1`), s'étirent (`align-items: stretch`) et ne défilent plus elles-mêmes.
- Chaque `.panneau-corps` défile seul. La barre Enregistrer reste collée en bas de la fiche, et l'en-tête de la liste reste visible.
- Un cadre court s'étire, mais on n'ajoute jamais de lignes vides. En dessous de 1360 px, la page garde son défilement naturel.

## Risques
- Les tests qui cherchent l'en-tête par son nom : le texte du `h2` est inchangé.
- La hauteur sur un petit écran : la règle ne s'applique qu'à partir de 1360 px.
