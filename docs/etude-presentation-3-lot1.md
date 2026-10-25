# Étude : lot « tout de suite » de la 3e présentation

Source : `docs/DEMANDES_PRESENTATION_3.md`, demandes 1, 13, 3, 7, 5, 9. Branche `presentation-3-lot1`.

## Besoin et contraintes
| # | Demande | Critère vérifiable |
|---|---|---|
| 1 | Nom de l'utilisateur dans la barre du haut | Prénom + nom (sinon l'adresse) visible à côté du bouton profil |
| 13 | Nouveau titre du graphe « Rémunération globale » | « Salaire, prime, rémunération et charges (FCFA) », ancienne phrase retirée |
| 3 | K et M | Indicateurs du résumé et axes / bulles des graphes en « 125,4 M », « 830 K » ; tableaux en chiffres entiers |
| 7 | Filtre par année sur les graphes | Même choix d'année de comparaison que le résumé ; courbe N-1 gardée |
| 5 | Contrat « Stage » | Type ajouté ; ligne Stage sans montant importée sans avertissement ; contrôle et graphe par contrat à jour |
| 9 | Lignes CA et Marge | Dans le tableau 1 du mensuel et de l'annuel, avec la comparaison |

Contraintes : montants `Decimal` côté serveur, calculs KPI côté serveur, périmètre filtré dans le dépôt, CA/Marge masqués sans la permission `marge:read`.

## Existant
- Barre du haut : `Layout.tsx` → `MenuProfil.tsx` (le nom n'apparaît que dans le menu ouvert).
- Formats : `lib/format.ts` (`fcfa`, `pct`, `entier`) ; graphes `pages/Graphes.tsx` (axe en millions à 2 décimales) ; tuiles `pages/Resume.tsx` (`montrer = fcfa`).
- Comparaison par année : `FiltresPeriode` (`comparaison="annee"`) + `useFiltres({ comparaison: 'annee' })`, déjà utilisés par Résumé et Annuel ; le serveur accepte `ref_annee`.
- Contrats : `referentiels_init.CONTRATS = CDI, CDD, MAD` ; le moteur boucle sur `refs.contrats` (lu en base), donc un nouveau type se propage seul. Libellé de contrôle figé « Total contrats = CDI + CDD + MAD ». Import : ligne sans montant → avertissement `LIGNE_SANS_MONTANT`.
- CA / marge : saisis par mois (`PeriodeData.ca/marge`) ; mensuel n'expose que la valeur du mois, annuel expose `ca_cumul` (N et N-1). `api/rapports.py` retire les clés `CLES_MARGE` sans `marge:read`.

## Options
| Sujet | Option | Pour | Contre |
|---|---|---|---|
| 3 K/M | A. Nouveau `compact()` dans `format.ts` | Un seul format, testé | — |
| | B. Format local par page | — | Doublons, écarts |
| 5 Stage | A. Référentiel + migration de données 0015 | Bases existantes à jour, moteur inchangé | Une migration |
| | B. Seulement `referentiels_init` | Simple | Bases déjà créées sans Stage |
| 9 CA/Marge | A. Cellules calculées par le serveur (`lignes_ca_marge`) | Règle « KPI côté serveur », masquage par `CLES_MARGE` | Petit ajout au moteur |
| | B. Calcul front depuis la synthèse | Pas de back | Pas de N-1 en mensuel, contraire à la règle |

Choix : A partout.

## Décisions par défaut (questions encore ouvertes)
- **Q5.1** (stagiaires dans effectif, rotation, absentéisme ?) : comptés comme les autres contrats, en attendant la réponse. Le filtre « Type de contrat » permet de les isoler.
- **Stage sans montant** : colonnes Activité, Site, Service, Mois toujours obligatoires (le périmètre en dépend) ; seul l'avertissement « ligne sans montant » est levé pour Stage.
- **Q9.1** (qui voit le CA ?) : règle actuelle conservée, lignes visibles avec la permission `marge:read` seulement.
- Lignes CA et Marge : sous le TOTAL GÉNÉRAL, hors total, colonnes budget vides. Marge annuelle = mois où la marge est saisie (comme « Marge cumulée »).
- K/M : à partir de 1 000 → K, de 1 000 000 → M, une décimale, sans décimale inutile (« 830 K »). Tableaux et exports inchangés.

## Impacts
- Données : migration `0015` (insertion idempotente de « Stage »). Aucun changement de schéma.
- Sécurité : nouvelle clé ajoutée à `CLES_MARGE` (masquée sans droit).
- Performance, déploiement, coûts : néant. i18n : français seul.

## Risques
- Libellé du contrôle des contrats changé : tests et recette à aligner.
- Arrondi d'affichage K/M : seul l'affichage arrondit, les valeurs restent exactes (bulles et tableaux en chiffres complets).
