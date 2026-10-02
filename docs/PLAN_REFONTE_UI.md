# Plan : refonte de l'interface (phase P5b)

Statut : proposé, non commencé. Rédigé le 2026-10-02.

## 1. Contexte et règle de coexistence

Le front fonctionnel (P5) est en cours : `Resume`, `Mensuel`, `Annuel`, `Individuel`, `Layout`, `FiltresPeriode`, `Lignes`, `Etat` sont écrits mais non commités ; la page `Graphes` n'existe pas encore. Une refonte visuelle menée en parallèle sur les mêmes fichiers créerait des conflits et des régressions.

**Règle : la refonte démarre une fois P5 commité et vert** (build, tests, Playwright par rôle). Elle ne modifie ni `api/`, ni `auth/`, ni `hooks/`, ni `lib/format.ts`, ni les règles de périmètre ou de masquage (marge sans `marge:read`, fiche nominative). Elle touche uniquement la présentation : `styles/`, `components/`, la structure JSX des `pages/`.

Ce qui est déjà en place et reste acquis : tokens cfaoacademy (rouge `#e3001b`, marine `#1a1f3c`, Space Grotesk / DM Sans / JetBrains Mono), React 19, TanStack Query, états `Etat` (vide, chargement, erreur).

## 2. Outils (déjà installés)

- `/impeccable init` (contexte : public DRH et direction, usage bureau, données financières sensibles, marque CFAO), puis `shape`, `critique`, `audit`, `polish`.
- `ui-ux-pro-max` : palette de données, types de graphiques, règles de tableaux.
- `design-taste-frontend` / `frontend-design` : éviter le rendu générique.
- `web-design-guidelines` : contrôle final accessibilité et bonnes pratiques.

## 3. Objectifs de design

Une application de reporting : sobre, dense là où il faut, jamais chargée. Le chiffre est le héros.

- **Épuré** : peu de couleurs, le rouge CFAO réservé à l'action et aux alertes, le marine aux structures, beaucoup d'espace blanc.
- **Hiérarchie des chiffres** : KPI en grand (chiffres tabulaires `font-variant-numeric: tabular-nums`), variation M-1 lisible d'un coup d'œil (flèche + signe + couleur + texte, jamais la couleur seule).
- **Tableaux de qualité** : en-têtes fixes, colonne de libellés figée, alignement à droite des montants avec séparateur de milliers et unité FCFA unique, lignes de total distinctes, survol discret, rubriques exclues clairement marquées.
- **Responsive réel** : poste de bureau d'abord (usage principal), tablette utilisable, mobile en lecture (tuiles en pile, tableaux défilants avec colonne figée).
- **Accessibilité** : contraste AA minimum, focus visible, navigation clavier, `prefers-reduced-motion`, libellés sémantiques.
- **Cohérence** : une seule échelle d'espacement, de rayons, d'ombres, de typographie, via les tokens.

## 4. Étapes

### R0. Cadrage (0,5 j)
1. `/impeccable init` ; produire `DESIGN.md` à la racine du front (principes, usages).
2. Capturer l'état « avant » de chaque page, par rôle (Playwright), dans `frontend/captures/avant/`.
3. Diagnostic en 5 lignes par page via `/impeccable critique`.

### R1. Fondations (1 j)
- Étendre `tokens.css` : échelle d'espacement (4/8/12/16/24/32/48), rayons, ombres, z-index, durées, couleurs sémantiques (succès, alerte, erreur, info) avec variantes douces, palette de données catégorielle à 6 teintes validée en contraste, mode sombre en option.
- Typographie : échelle fluide (`clamp`), chiffres tabulaires, graisses limitées à 2 ou 3.
- `base.css` : reset, focus, liens, tableaux, impression.
- Gabarit de grille (12 colonnes, largeur max de lecture, marges fluides).

### R2. Composants (1,5 j)
Refaire ou créer, avec tests de rendu :
- `Layout` : en-tête compact, navigation par onglets claire (état actif net), menu utilisateur, menu mobile repliable.
- `FiltresPeriode` : barre de filtres collante, état résumé en puces (« Juin 2026 · Siège · RH »), bouton de réinitialisation.
- `Tuile` (KPI) : valeur, libellé, variation, mini-courbe optionnelle.
- `Lignes` / tableau de données : voir §3.
- `Etat` : squelettes de chargement à la forme de la page, vide avec explication, erreur avec action, accès refusé distinct.
- `Badge`, `Bouton`, `Carte`, `Section repliable`.

### R3. Pages, dans l'ordre de valeur (2,5 j)
1. **Résumé** : bandeau de période, 4 à 6 KPI maximum, un graphe de tendance, puis seulement les alertes notables. Pas de mur de tuiles identiques.
2. **Mensuel** : synthèse en tête, blocs repliables par thème (effectifs, masse salariale, contrats), comparaison M-1 et N-1 en colonnes, tableau dense mais aéré.
3. **Annuel** : vue en grille mois par mois avec totaux et tendance, choix de la rubrique pour le graphe.
4. **Individuel** : fiche lisible, identité et contrat d'abord, historique ensuite ; mention discrète de la traçabilité de lecture (`lecture_fiche`) ; données sensibles non affichées par défaut.
5. **Graphes** (page à créer) : bibliothèque légère (Recharts ou visx, à trancher en R0), 4 graphes utiles max, couleurs de la palette données, infobulles, version tableau accessible.
6. **Connexion** : sobre, logo, un seul bouton principal, messages d'erreur clairs.
7. **Pages d'administration (P6)** : appliquer le même kit dès leur création, sans refonte ultérieure.

### R4. Finition et contrôle (1 j)
- `/impeccable polish`, puis `/impeccable audit` ; `web-design-guidelines` en revue finale.
- Vérifications : axe (accessibilité), Lighthouse (performance, accessibilité > 95), 3 largeurs (1440, 1024, 390), impression d'un rapport.
- Captures « après » dans `frontend/captures/apres/`, tableau de comparaison avant/après.

## 5. Critères d'acceptation

- `npm run build` et `npm test` verts ; Playwright par rôle inchangé (les assertions de données ne sont pas affaiblies).
- Aucun montant, aucun libellé, aucune règle de masquage modifiés : comparaison des valeurs affichées avant/après identique.
- Contraste AA sur tout texte ; navigation clavier complète ; pas de défilement horizontal de la page à 390 px (seuls les tableaux défilent, colonne de libellés figée).
- Lighthouse accessibilité >= 95 sur chaque page.
- Dossier de captures avant/après livré, validé par l'admin.

## 6. Risques

| Risque | Parade |
|---|---|
| Conflit avec le travail P5 en cours | Démarrer R0 seulement après le commit P5 ; branche dédiée `refonte-ui` |
| Régression des règles de masquage (marge, nominatif) | Tests de rôle conservés ; relecture du diff sur `can(...)` |
| Graphes qui alourdissent le bundle | Chargement différé de la page Graphes, bibliothèque légère |
| Dérive esthétique entre pages | Kit de composants unique, `DESIGN.md` comme référence |

## 7. Découpage en commits

Format du dépôt `NN-x: description`, par exemple :
`05b-ui: fondations (tokens, typographie, grille)`, `05b-ui: composants (layout, filtres, tuile, tableau, états)`, `05b-ui: page Résumé`, … `05b-ui: audit et captures avant/après`.

## 8. Estimation

Environ 6,5 jours de travail, hors page Graphes si P5 la livre d'abord au format simple.
