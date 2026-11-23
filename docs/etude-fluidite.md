# Étude : fluidité des écrans (point 26)

## 1. Besoin
- Un clic ne fait jamais attendre : il déclenche quelque chose tout de suite (état actif, squelette), sans lag ni saccade.
- Une seule animation de squelette, synchrone partout, au lieu d'une animation par cellule.
- Moins de calculs côté navigateur.
- Mesurer toutes les pages, en distinguant la **1re ouverture** (code et données à charger) et la **réouverture** (déjà en mémoire).

Critères d'acceptation (CPU bridé ×4, version compilée) :
- clic → première image < 200 ms sur toutes les actions (seuil « bon » de l'INP : 200 ms) ;
- aucune image > 200 ms après le clic sur une réouverture ;
- au plus quelques animations simultanées pendant un chargement (aujourd'hui 500 à 1 100) ;
- aucun changement visuel voulu, sauf le squelette qui pulse d'un seul bloc.

## 2. Méthode de mesure
Spec `frontend/e2e-recette/90-fluidite.spec.ts`, lancée à la demande sur la version compilée :

```
npm run build
MESURE=1 [MESURE_CPU=4] [MESURE_PROFIL=<action>] E2E_PREVIEW=1 E2E_BASE=recette-e2e.db E2E_API_PORT=8010 \
  npx playwright test -c playwright.recette.config.ts e2e-recette/90-fluidite.spec.ts --reporter=line
```

- **Clic** : durée Event Timing (du clic à l'image qui suit).
- **Données** : du clic jusqu'à ce que la partie visible ne soit plus en attente (`aria-busy`).
- **Longues images** (Long Animation Frames > 50 ms) : temps de script, mise en page forcée par les scripts, rendu.
- **Animations** : maximum de `document.getAnimations()` pendant l'action.
- `MESURE_PROFIL` : profil processeur (`test-results/profil-*.cpuprofile`), lu avec les sourcemaps.
- Toutes les pages du menu Rapports et tous les onglets Administration, en 1re ouverture puis en réouverture ; plus quatre actions dans une page (période, rail, menu des groupes).

## 3. Mesures (avant)
Écran 1440 × 900, base de recette (98 salariés, 2024 → 2026-06).

### CPU normal (×1)
| Action | Clic | Animations simultanées |
|---|---|---|
| Rapports (Résumé, Graphes, Annuel, Mensuel, Individuel) | 110 à 185 ms | 560 à 843 |
| Administration (onglets) | 16 à 40 ms | jusqu'à 968 (Données) |
| Mensuel : changer la période | — | 1 097 |
| Individuel, 1re ouverture | — | données à 2,2 s |

### CPU bridé ×4 (poste lent)
| Action | Clic | Données | Script | Mise en page forcée |
|---|---|---|---|---|
| Annuel, 1re ouverture | 232 ms | 5,6 s | 3,8 s | 1,4 s |
| Annuel, réouverture | 752 ms | 4,5 s | 2,1 s | 0,9 s |
| Individuel, 1re ouverture | 416 ms | 6,9 s | 4,2 s | 3,65 s |
| Individuel, réouverture | 720 ms | 2,6 s | — | — |
| Mensuel (1re et réouverture) | ~300 ms | 2,3 à 2,5 s | — | — |
| Mensuel : changer la période | 1 168 ms | 7,5 s | 2,4 s | 1,9 s |
| Graphes : point du rail | 504 ms | 4,2 s | 2,6 s | 1,2 s |
| Graphes : menu des groupes | 72 ms | 3,65 s | 2,5 s | 1,4 s |
| Administration / Données | — | 2,8 à 4,2 s | — | — |

Constats :
- La page reste petite (au plus 2 650 éléments) : la lenteur ne vient pas de sa taille.
- La **réouverture n'est pas plus rapide** que la 1re ouverture (Annuel : clic 752 ms au lieu de 232 ms). Les données sont en cache (5 min) ; le coût est entièrement dans le navigateur (rendu, mises en page, animations).

### Profil « Annuel, réouverture » (×4, temps propre)
| Poste | Temps | Origine |
|---|---|---|
| recharts | ~2,0 s (dont axes `CartesianAxis` 1,05 s, `getTotalLength` 0,46 s) | graphiques de **Graphes**, encore en cours de montage et d'animation après avoir quitté la page |
| `getBoundingClientRect` | 0,59 s | mises en page forcées (`lib/plafond.ts`) |
| react-dom | 0,61 s | rendu des tableaux |
| `getAnimations` | 0,35 s | coût de la mesure elle-même (ignoré) |

## 4. Causes identifiées
1. **Mises en page forcées en boucle** (`lib/plafond.ts`) :
   - `plafonner` écrit un style, lit la hauteur de chaque ligne, réécrit, relit : deux mises en page complètes par panneau ;
   - `entetesDeuxLignes` élargit chaque en-tête de 8 px et remesure jusqu'à tenir sur deux lignes : une mise en page par pas de 8 px et par colonne (Individuel : 3,65 s à ×4) ;
   - `SnapSections.tsx` relance `plafonner` sur toutes les sections à chaque changement du DOM (MutationObserver sur tout l'arbre), donc à chaque arrivée de données et à chaque passage du squelette.
2. **Squelette : trois animations par cellule** (`styles/base.css`, `sk-masquer`, `sk-cacher`, `sk-pouls`) : 500 à 1 100 animations simultanées. Chaque barre qui pulse devient un calque à composer.
3. **Graphiques** (Graphes) :
   - animation d'entrée de 450 ms sur chaque série ;
   - la file de montage (`useMontageDiffere.ts`) continue après le départ de la page : le travail déborde sur la page suivante ;
   - les axes recalculent la taille des libellés (mesure du texte) à chaque rendu.
4. **Rendu au clic** : la navigation et le changement de période rendent tout l'écran dans la même image que le clic ; rien n'apparaît tant que ce rendu n'est pas fini.

## 5. Options

### 5.1 Mises en page forcées
| Option | Pour | Contre |
|---|---|---|
| A. Lire tout, puis écrire tout (en lot), calcul des en-têtes en une mesure (largeur du mot le plus long, sans boucle) | Supprime l'essentiel du coût ; même rendu | Réécriture de `plafond.ts` à tester finement |
| B. Tout en CSS (`max-height`, `text-wrap: balance`, `min-width` en `ch`) | Zéro script | Ne reproduit pas exactement « barre seulement si nécessaire » ni « deux lignes au plus » |
| C. Garder, mais limiter l'observateur aux arrivées de données | Simple | Le coût par passage reste |

### 5.2 Squelette
| Option | Pour | Contre |
|---|---|---|
| A. Délai d'apparition géré par une classe posée par `useAttente` (déjà minuté à 300 ms) + **une seule animation** de pulsation par zone (propriété CSS déclarée `--sk-o`, lue par toutes les barres) | 1 animation par zone au lieu de ~3 par cellule ; pulsation parfaitement synchrone (idée de l'utilisateur) | Chaque image de la pulsation recalcule le style des barres : à mesurer (repli : pulsation en paliers) |
| B. Garder une animation par cellule, retirer seulement `sk-masquer` et `sk-cacher` | Simple | Toujours des centaines d'animations ; pas synchrone si les zones arrivent à des moments différents |
| C. Squelette fixe sans pulsation | Coût nul | Perd le signal « ça charge » |

### 5.3 Graphiques
| Option | Pour | Contre |
|---|---|---|
| A. Vider la file de montage au départ de la page ; animation d'entrée coupée sur les réouvertures ; données et formats des axes mémorisés | Plus de débordement sur la page suivante ; moins de rendus | L'animation d'entrée reste à la 1re ouverture |
| B. Changer de bibliothèque | — | Hors périmètre (dépendances figées) |

### 5.4 Réponse immédiate au clic
| Option | Pour | Contre |
|---|---|---|
| A. Rendu lourd en transition React (`startTransition`) : le menu et le squelette changent tout de suite, les tableaux suivent | Le clic répond dans l'image suivante | Il faut garder un état visible pendant la transition |
| B. Préchargement des données au survol des liens du menu | 1re ouverture plus rapide | Requêtes en plus si l'utilisateur survole sans cliquer |

## 6. Recommandation
Dans cet ordre, une mesure avant/après à chaque étape (même spec) :
1. **`plafond.ts` (5.1)** : CSS d'abord (5.1 B) partout où il donne le même rendu ; le reste en lot, une lecture puis une écriture (5.1 A). `ResizeObserver` sur les panneaux au lieu du MutationObserver sur tout l'arbre. C'est le premier poste (jusqu'à 3,65 s).
2. **Squelette (5.2)** : la structure reste celle demandée (titres, en-têtes, libellés affichés ; une barre à la place de chaque valeur, à sa taille). On garde une seule animation au lieu de trois par valeur : le délai de 300 ms passe par une classe posée par `useAttente`. La pulsation, en `opacity` seulement, démarre au même instant pour toutes les barres, donc elle est synchrone. On mesure aussi une animation unique partagée (variable CSS animée) et on garde la moins coûteuse.
3. **Graphes (5.3 A)** : file vidée au départ, pas d'animation d'entrée en réouverture, axes mémorisés.
4. **Clic immédiat (5.4 A)**, puis préchargement au survol (5.4 B) pour la 1re ouverture.

Pratiques de référence suivies : seuil INP 200 ms (web.dev), pas d'alternance lecture/écriture de mise en page (web.dev « avoid layout thrashing »), animations limitées à `opacity`/`transform`, `startTransition` pour le rendu non urgent (doc React), préchargement TanStack Query (`prefetchQuery`), mesure avant/après sur poste bridé.

## 7. Impacts et risques
- Aucun changement de données, d'API ni de dépendance. Tout se passe dans `frontend/`.
- Risque principal : le dimensionnement des sections (étape 25-g, jugé bon). Garde-fou : la recette `80-defilement` (tailles, barre seulement si nécessaire, en-têtes sur deux lignes) doit rester verte, ainsi que vitest.
- Squelette : la recette vérifie déjà le délai de 300 ms et le cycle minimal (`useAttente`).
- Mouvement réduit : la pulsation reste coupée.

## 8. Réalisation

### Étape 1 : mises en page forcées (`26-b`)
- `lib/plafond.ts` : `plafonnerTout` traite tous les panneaux en lot (toutes les écritures, une série de lectures, puis les écritures finales) au lieu d'alterner lecture et écriture panneau par panneau. Calcul inchangé.
- `entetesDeuxLignes` : toutes les colonnes cherchées à la fois, essai de 1, 2, 4… pas puis dichotomie ; une mise en page par tour au lieu d'une par pas de 8 px et par colonne. Même largeur finale au pixel près (banc sur le tableau Individuel : identique, 430 ms → 170 ms à CPU ×4).
- `SnapSections` : l'observateur ne relance le calcul que si des éléments sont ajoutés ou retirés (arrivée des données, lignes), plus pour un simple changement de texte.
- Écart avec la recommandation : pas de `ResizeObserver`. Les panneaux ont une hauteur fixée par le calcul ; l'arrivée de lignes ne change donc pas leur taille et un `ResizeObserver` ne la verrait pas. Pas de CSS seul non plus : il ne reproduit ni « barre seulement si nécessaire » ni « deux lignes au plus » (5.1 B).

Mesure à CPU ×4 (avant → après) :
| Action | Données affichées | Mise en page forcée |
|---|---|---|
| Annuel, 1re ouverture | 8,8 s → 5,0 s | 2,2 s → 1,2 s |
| Mensuel, 1re ouverture | 5,1 s → 1,6 s | 1,4 s → 0,1 s |
| Mensuel : changer la période | 11,2 s → 7,1 s | 1,5 s → 1,1 s |
| Graphes : point du rail | 8,8 s → 3,1 s | 2,5 s → 0,7 s |
| Admin / Données, réouverture | 3,9 s → 2,5 s | 0,5 s → 0,4 s |
| Individuel, 1re ouverture | 6,0 s → 5,2 s | 1,3 s → 2,5 s (variance : 3,65 s dans la mesure de l'étude ; le banc direct montre un gain) |

La mesure varie d'un passage à l'autre (même action : jusqu'à ×2). L'échantillonnage du nombre d'animations (`getAnimations` toutes les 50 ms) coûte lui-même ~1 s à ×4 : il gonfle les chiffres de toutes les actions, avant comme après.
