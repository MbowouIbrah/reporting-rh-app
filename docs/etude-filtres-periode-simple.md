# Étude : filtres Période et Comparaison simplifiés (R6, 2e version)

## Besoin
Retour sur la 1re version (menu Période à 5 raccourcis + Calendrier + Comparer à) : trop long et trop complexe.
Le besoin réel tient en une phrase : **comparer une période à une autre**, avec le moins de réglages possible.

- Par défaut : **un mois comparé à un autre** (dernier mois saisi comparé au mois d'avant).
- **Une année comparée à une autre**, en année civile (janvier → décembre) ou fiscale (avril → mars).
- En plus : **un trimestre comparé à un autre** (ex. T1 comparé à T2).

## Existant
- Pages annuelles : bouton « Période » ouvrant un menu (Afficher : Mois / Trimestre / Cumul / Année / De… à… ; Choix : année + mois ; Calendrier : civil / fiscal), plus une liste « Comparer à » (N-1, période précédente, aucune).
- Page Mensuel : son propre filtre (mois + mois de comparaison).
- Le serveur sait déjà calculer une période (`debut`, `mois`) et sa période de comparaison (`ref_annee`, `cmp`). Ce qui change, c'est surtout l'écran.

## Ce que font les outils connus
| Outil | Façon de choisir |
|---|---|
| Google Analytics, Matomo | une période + « Comparer à : période précédente / même période l'an dernier / personnalisée » |
| Power BI, Excel (segments) | un pas de temps (mois, trimestre, année) puis la valeur |
| Logiciels de paie / SIRH | « Mois de paie » + « comparé à » |

Règle commune : **on choisit d'abord le pas (mois, trimestre, année), puis les deux périodes du même pas.** On ne compare pas un mois à un trimestre.

## Retour sur la 1re maquette
Onglets « Mois · Trimestre · Année » avant de choisir = un filtre dans le filtre, trop complexe.
Règle demandée : **c'est ce qu'on choisit qui décide du type de comparaison.**

## Principes retenus
1. **Deux filtres seulement** : « Période » et « Comparer à », chacun présenté comme un calendrier.
2. **Année seule → comparaison annuelle ; année + mois → mensuelle ; deux mois choisis → une période** (ex. T1 = janvier puis mars).
3. **Civil / fiscal (avril → mars)** se choisit dans le calendrier, pas dans un filtre à part.
4. **« Comparer à » se remplit seul** avec la période précédente du même type (année d'avant, mois d'avant, même période l'an dernier) ; on peut la changer.
5. **Année en cours comparée à mois égaux** : 2026 (janv. → oct.) contre 2025 (janv. → oct.).
6. Disparaissent : Cumul, De… à…, Aucune comparaison, les onglets de pas.

## Variantes en maquette (`docs/maquettes/reunion-17-11/periode.html`)
| Variante | Principe | Pour | Contre |
|---|---|---|---|
| A. Calendrier des mois | Bouton qui ouvre un calendrier : Civile/Fiscale, ◀ année ▶ (clic sur l'année = toute l'année), grille de 12 mois (1 clic = un mois, 2e clic = période) | Standard des sélecteurs de mois ; une période peut chevaucher deux années ; barre courte | Il faut ouvrir le calendrier |
| B. Année + mois en listes | Liste Année (civiles et exercices fiscaux), liste Mois (« Toute l'année » ou un mois), « + jusqu'à… » pour une fin | Tout visible sans ouvrir de menu | Période limitée à une même année ; 2 à 3 listes par filtre |

Version validée par l’utilisateur : **A, calendrier compact** (les listes déroulantes ont été essayées puis écartées) :
- plus de choix civil / fiscal : une période peut chevaucher deux années, l’exercice fiscal se choisit donc comme une période (avril 2025 → mars 2026) ;
- calendrier compact : ◀ année ▶ (clic sur l’année = toute l’année), 12 mois sur 3 lignes, un seul bouton OK ;
- un 2e clic sur un mois ou sur l’année déjà choisis les désélectionne ; OK grisé tant que rien n’est choisi ;
- rien ne s’applique avant OK (Échap ou clic à côté annule) ; aperçu de la période au survol après le 1er mois ;
- libellé toujours complet : « Janvier → décembre 2025 », « Janvier → octobre 2026 » (année en cours), « Avril 2025 → mars 2026 ».

## Impacts
- Front : un composant `ChoixPeriode` remplace `ChoixPeriodeAnnuelle` et le filtre de la page Mensuel (même barre partout).
- Serveur : passer d'un `ref_annee` à une période de comparaison complète (début, fin) ; le calcul par bornes existe déjà. Pas de migration.
- Liens partagés : les clés `vue`, `debut`, `fin`, `cmp` sont remplacées par `periode` et `comparee` (type, début, fin, calendrier) ; les anciennes valeurs sont relues une fois puis ignorées.
- Tests : `periode.test.ts` à refaire sur les nouvelles règles (périodes précédentes, alignement des mois).

## Point à trancher par l’utilisateur
Aucun : version validée le 18/11/2026.
