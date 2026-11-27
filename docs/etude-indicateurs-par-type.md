# Étude : indicateurs de Budget réalisé regroupés par type, groupe « Personne »

## 1. Besoin (27/11)

- Regrouper les indicateurs de Budget réalisé par type.
- Un filtre « Types d'indicateurs » choisit les groupes affichés.
- Nouveau groupe **Personne** : sexe, âge, ancienneté (durée depuis l'embauche).

## 2. Existant

| Élément | Où | Constat |
|---|---|---|
| 8 cartes | `frontend/src/pages/Resume.tsx` l.287-498 | CA, Commissions, Masse salariale, Part des MAD / Marge, Primes, Effectif global, CA par salarié. Grille de 4 (`.cases`, `base.css` l.289). |
| Tableau « Suivi mensuel » | `Resume.tsx` l.267 | Colonnes CA, Marge, % marge, Masse salariale, Commissions, Primes, Frais de mission, Logement site déporté. |
| Préférences par compte | `PreferenceUtilisateur` | Déjà utilisé pour « Personnaliser » ; réutilisé tel quel (clé `affichage.resume`). |
| Données personne | `imports/paie.py` | Civilité, Date de naissance, Date d'embauche **ignorées** à l'import (`etude-import-paie.md` §3a). Nature du contrat est déjà lue. |
| Règles déjà décidées | `etude-filtres-affichage-comparaison.md` §3-4 | Tranches d'âge et d'ancienneté, seuil de 3 personnes sauf `nominatif:read`, masquer n'est pas un droit. |

## 3. Groupes proposés

| Groupe | Cartes | Colonnes du tableau |
|---|---|---|
| Activité | CA, Marge, Commissions, CA par salarié | CA, Marge, % marge |
| Masse salariale | Masse salariale, Primes de productivité | Masse salariale, Commissions, Primes, Frais de mission, Logement |
| Effectif | Effectif global, Part des MAD | — |
| Personne (nouveau) | Sexe, Âge, Ancienneté, Type de contrat | — |

Les groupes de 2 cartes partagent une ligne : l'écran garde ses lignes de 4 cartes. Commissions va dans Activité (suit les ventes) ; elle reste dans les colonnes de paie du tableau.

## 4. Options pour le filtre

| Option | Pour | Contre |
|---|---|---|
| **A. Liste à cases dans la barre de filtres, mémorisée par compte** | Même geste que les autres filtres ; un clic | Un filtre de plus dans la barre |
| B. Bouton « Affichage » à part | Sépare filtres de données et affichage | Deux endroits pour régler l'écran |
| C. Onglets par groupe | Écran très léger | Un seul groupe visible à la fois, pas de vue d'ensemble |

**Choix : A.** Par défaut tout est coché. Le choix n'est pas mis dans l'adresse (préférence personnelle, pas un filtre de données). Un rappel « 1 type masqué » évite de croire qu'une donnée manque.

## 5. Calculs du groupe Personne (serveur)

- Base : salariés présents au dernier mois de la période (même base que « Effectif global »), filtre de périmètre dans la couche dépôt.
- Sexe : Civilité M. → H, Mme / Mlle → F.
- Âge et ancienneté : au dernier jour du dernier mois ; moyenne + tranches (âge : <25, 25-34, 35-44, 45-54, 55+ ; ancienneté : <1, 1-3, 3-5, 5-10, 10+ ans).
- Type de contrat : répartition CDI / CDD / autres (donnée déjà importée).
- Valeur absente → « Non renseigné », comptée à part, jamais devinée.
- Moins de 3 personnes et pas de `nominatif:read` → « Sélection trop petite » au lieu des chiffres.
- Comparaison : même calcul sur la période ou la sélection comparée, écart en points.

## 6. Impacts

- Migration : `salarie.civilite`, `salarie.date_naissance`, `salarie.date_embauche` (nullables).
- Import : lecture des 3 colonnes (noms de `etude-import-paie.md`, dates `JJ/MM/AAAA`) ; fichiers déjà importés : « Non renseigné » jusqu'au prochain import.
- Export PDF / Excel : inchangé, garde tout.

## 7. Risques et points ouverts

- Q1 client (noms exacts des colonnes) toujours sans réponse : défauts ci-dessus.
- « Durée du contrat » compris comme l'ancienneté ; la date de fin des CDD n'est pas dans le fichier.
