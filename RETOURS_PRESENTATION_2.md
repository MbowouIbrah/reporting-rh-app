# Retours de la 2e présentation : feuille de route

Base : `main` = `3a37b92`. Branche : `retours-presentation-2`.
Méthode : un lot par page. Toutes les modifications d'une page, puis test et validation à l'écran, commit `11: …`, lot suivant.
Lecture retenue : quand une note laisse deux sens possibles, la colonne « Lecture » dit lequel est appliqué. Les questions bloquantes sont en fin de fichier.

## Lot 1 : Résumé

Disposition cible (4 colonnes, deux lignes) :

| | Col. 1 | Col. 2 | Col. 3 | Col. 4 |
|---|---|---|---|---|
| Ligne 1 | Chiffre d'affaires | Commissions | Masse salariale | MAD |
| Ligne 2 | Marge | Primes de productivité | Effectif global | CA par salarié |

| # | Modification | Lecture | Fichiers |
|---|---|---|---|
| 1.1 | CA, Primes de productivité, CA par salarié : évolution en % par rapport à N-1, présentée comme Commissions (▲ +x % sous « Par rapport à 2025 »). | Même composant que Commissions. Si N-1 n'est pas saisi : « — ». | `Resume.tsx` |
| 1.2 | Carte Effectif sous la masse salariale : effectif **global de fin** (dernier mois saisi) au lieu de la moyenne ; évolution % par rapport au même mois N-1 ; bulle : effectif et % par type de contrat (CDI, CDD, MAD). | Effectif fin = effectif du dernier mois saisi de la période. | `moteur.py`, `Resume.tsx` |
| 1.3 | Masse salariale : bulle avec la masse et le % par type de contrat (CDI, CDD, MAD). | Cumul de la période par contrat / cumul total. | `moteur.py`, `Resume.tsx` |
| 1.4 | Carte MAD à la place de l'ancienne carte Effectif (colonne 4) : **MAD globaux** en valeur principale, **MAD sites déportés** en dessous (nombre et % des MAD globaux). | Même base que la carte Effectif : effectif de fin. | `moteur.py`, `Resume.tsx` |
| 1.5 | Tableau Suivi mensuel, colonnes dans cet ordre : Mois, CA, Marge, % marge, Masse salariale, Commissions, Primes prod., Frais de mission, Logement site déporté. | Deux colonnes ajoutées (frais de mission, logement). | `moteur.py` (série), `Resume.tsx` |
| 1.6 | Filtres du résumé : type de site, site, service, activité (mêmes contrôles que Mensuel/Annuel). | Filtre appliqué côté serveur. Voir Q3 pour le CA et la marge. | `rapports.py`, `Resume.tsx` |

Critères : disposition ci-dessus ; chaque carte garde sa bulle de détail ; les totaux du tableau égalent les cartes ; un filtre change toutes les cartes concernées.

## Lot 2 : Graphiques

| # | Modification | Lecture | Fichiers |
|---|---|---|---|
| 2.1 | Effectif : courbes uniquement, une par type de contrat (CDI, CDD, MAD), valeur inscrite sur chaque point, comme la courbe actuelle du graphique masse salariale. | Les barres empilées disparaissent. | `Graphes.tsx` |
| 2.2 | Masse salariale mensuelle : même présentation que Rémunération globale (aire N, pointillés N-1). | La courbe d'effectif sort de ce graphique (elle a le sien). | `Graphes.tsx` |

## Lot 3 : Mensuel et Annuel

| # | Modification | Lecture | Fichiers |
|---|---|---|---|
| 3.1 | Répartition par site : ligne TOTAL GÉNÉRAL (masse salariale et effectif), comme dans l'Excel source. | Total de toutes les lignes affichées (après filtre), y compris budget et écarts. | `BlocsRapport.tsx` |
| 3.2 | Répartition par service et activité : dépliage CDI / CDD / MAD, comme pour les sites. | Effectif et masse salariale par contrat. | `moteur.py`, `BlocsRapport.tsx` |

## Lot 4 : Reporting individuel et tableau Données

| # | Modification | Lecture | Fichiers |
|---|---|---|---|
| 4.1 | Colonnes hachurées (hors total) placées en début, juste après le mois ; même ordre dans le tableau Données de l'administration. | | `Individuel.tsx`, `Donnees.tsx` |
| 4.2 | Colonnes déplaçables (glisser l'en-tête). | Ordre mémorisé dans le navigateur, par tableau ; bouton pour revenir à l'ordre d'origine. | `Individuel.tsx`, `Donnees.tsx` |
| 4.3 | Commission sortie du total (hachurée) ; le total compte : Brut réel, Bonus, TVA & Marge MAD, Crédit téléphonique, Frais de mission, Primes exceptionnelles, Logement site déporté, Carburant. | Voir Q1 (étendue de la règle et rubriques non citées). | règles d'exclusion (migration de données) |
| 4.4 | Colonne « Total budget » retirée du reporting individuel. | | `Individuel.tsx`, API individuel |

## Lot 5 : Rôles et périmètres

| Personne / fonction | Rôle | Lecture | Écriture | Périmètre |
|---|---|---|---|---|
| Administrateurs RH | Administrateur RH | Tout | Tout | Global |
| DRH, DOP | Lecteur global | Tout | Non | Global |
| DPS (Direction pièces et service) | Lecteur à périmètre | Oui | Non | Commerce Pièces, SAV PL, SAV Engins, Sites Déportés |
| Directeur commercial | Lecteur à périmètre | Oui | Non | Commerce VN |
| DC Pneumatique | Lecteur à périmètre | Oui | Non | Pneumatique |
| Directeur technique | Lecteur à périmètre | Oui | Non | SAV PL |
| Responsable technique SAV Engins | Lecteur à périmètre | Oui | Non | SAV Engins |
| Responsable des sites déportés | Lecteur à périmètre | Oui | Non | Sites Déportés (voir Q2) |

Lecture : deux administrateurs RH de même niveau (remplace la décision D2 « un seul administrateur ») ; périmètres créés par migration de données ; lecteurs à périmètre sans détail nominatif ni marge (D4, D5 inchangés) ; comptes créés à la mise en service avec les adresses réelles (`python -m app.comptes`). Fichiers : migration, `docs/P0_CADRAGE.md` §2, `docs/RUNBOOK.md` §2.

## Lot 6 : Modèle d'import

| # | Modification | Lecture | Fichiers |
|---|---|---|---|
| 6.1 | Modèle d'import identique à la feuille DONNEES de l'Excel REPORTING RH : titre ligne 1, consigne ligne 2, en-têtes ligne 3, mêmes colonnes dans le même ordre (ANNÉE … TVA & Marge MAD). | | `imports/modeles.py`, `tools/generer_template_import.py`, `templates/` |
| 6.2 | Import direct du fichier Excel REPORTING RH (feuille DONNEES, plusieurs mois) : colonnes calculées (TOTAL CHARGES, Total exclusions, colonnes « (norme) ») ignorées sans avertissement bloquant. | Test avec `REPORTING_RH_V5.xlsx`. | `imports/lecture.py`, `regles.py`, tests |

## Questions bloquantes (défaut appliqué si pas de réponse)

| # | Question | Défaut |
|---|---|---|
| Q1 | Sortir la commission du total s'applique-t-il à toute l'application (masse salariale du résumé, du mensuel, de l'annuel), comme les autres colonnes hachurées ? Charges patronales, Assurance maladie et Formation, non citées, restent-elles dans le total ? | Oui partout (une seule règle, le tableau Données fait référence) ; les trois rubriques restent comptées. |
| Q2 | « Responsable des sites déportés » : le service Sites Déportés, ou tous les sites de type déporté quel que soit le service ? | Le service Sites Déportés. |
| Q3 | Résumé filtré par site ou service : le CA et la marge n'existent qu'au global. | Avec un filtre actif, les cartes CA, Marge et CA par salarié et les colonnes CA/marge du tableau sont masquées, avec une phrase qui le dit. |
