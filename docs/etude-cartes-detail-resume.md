# Étude : cartes de détail au survol des KPI du Résumé (étape B, 26/11)

## Besoin
Chaque case du Résumé (CA, commissions, masse salariale, part des MAD, marge, primes, effectif global, CA par salarié)
montre au survol une carte de détail qui explique le chiffre. Normes visées : Nielsen (visibilité de l'état, reconnaissance
plutôt que rappel, cohérence), WCAG 2.2 (1.4.13 contenu au survol/focus, 2.1.1 clavier, 1.4.3 contraste, 2.5.8 cible),
IBCS (notation période / comparaison, écarts explicites, unités uniques).

## Existant
- `components/BulleCases.tsx` : une bulle unique, en `fixed` sous la case, qui glisse d'une case à l'autre ; liste plate
  libellé / valeur (`Detail = [string, string][]`).
- `pages/Resume.tsx:214-305` : le contenu de chaque bulle est construit dans la page (montants exacts, sans arrondi).
- Données disponibles dans `/rapports/annuel` : cellules m / m1 / var / var_pct, répartitions par contrat et FO/BO,
  `serie_n` / `serie_n1` mois par mois (ms, commissions, primes, effectif, ca, marge).

## Écarts relevés
| Norme | Écart actuel |
|---|---|
| WCAG 1.4.13 survolable | `pointer-events: none` : impossible de passer la souris sur la bulle pour la lire ou la sélectionner |
| WCAG 1.4.13 masquable | pas de fermeture par Échap sans déplacer le focus |
| Toucher (mobile, tablette) | aucune ouverture au toucher ; le détail n'existe pas sur mobile |
| Nielsen, reconnaissance | liste plate : on ne voit pas ce qui est période, comparaison, composition ; les libellés répètent la période |
| Nielsen, cohérence | 8 bulles construites différemment (Part des MAD : 8 lignes mêlant moyennes et fins de mois) |
| IBCS | l'écart et l'évolution ne sont pas mis en évidence ; aucune indication de calcul |

## Options
| Option | Pour | Contre |
|---|---|---|
| A. Bulle actuelle corrigée (accessibilité seule) | Peu de code | Ne règle pas la lecture |
| B. Carte structurée en sections (comparaison, composition, calcul) | Lecture guidée, même gabarit pour les 8 ; aucun nouveau calcul | Carte plus haute (≈ 220-300 px) |
| C. B + mini-courbe mensuelle période / comparaison | Montre la tendance, réponse à « d'où vient l'écart » | Plus de hauteur ; pas de courbe utile pour Part des MAD et CA par salarié (pas de série) |

## Choix recommandé : C (B pour les KPI sans série mensuelle)
Gabarit unique de carte (largeur 340 px) :
1. **En-tête** : nom du KPI, période et période comparée.
2. **Comparaison** : période, comparaison, écart, évolution (couleur : vert/rouge seulement pour CA, marge, CA par salarié ;
   ailleurs neutre, règle existante). Montants exacts, unité FCFA une fois.
3. **Mini-courbe** : mois de la période (trait plein) et de la comparaison (pointillé), à partir de `serie_n` / `serie_n1`.
4. **Composition** : barres de part (par contrat, FO/BO), valeur exacte et part.
5. **Calcul** : une phrase (« Somme des CA saisis des mois de la période »), mois saisis, mention « partiel » expliquée.

Comportement (WCAG 1.4.13) : ouverture au survol après 150 ms, au focus clavier, au toucher ; la carte reste tant que le
pointeur est sur la case ou sur la carte ; Échap ferme ; clic ailleurs ferme ; placement sous la case, au-dessus s'il
manque de place, recalé dans l'écran ; `prefers-reduced-motion` : pas de glissement.

## Impacts
- Données : aucun nouveau calcul côté front ; les chiffres viennent de l'API (règle « calculs KPI côté serveur »).
  La mini-courbe affiche les valeurs mensuelles brutes déjà servies.
- Code : `BulleCases` passe d'une liste à un contenu structuré (sections typées) ; `Resume.tsx` décrit chaque carte.
- Tests : Vitest (contenu des cartes, Échap, toucher) ; Playwright de capture.
- Impression / PDF : cartes masquées (inchangé).

## Risques
- Hauteur de la carte sur petits écrans : la carte se limite à la hauteur de l'écran et défile à l'intérieur.
- La glisse entre cases voisines doit rester fluide avec une carte survolable (délai de fermeture conservé).

## À valider par l'utilisateur
Structure des cartes sur la maquette `docs/maquettes/resume-cartes/index.html` (option C, bascule vers B possible).
