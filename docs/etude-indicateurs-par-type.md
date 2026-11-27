# Étude : indicateurs de Budget réalisé regroupés par type, groupe « Profil des salariés »

## 1. Besoin (27/11)

- Regrouper les indicateurs de Budget réalisé par type.
- Un filtre « Types d'indicateurs » choisit les groupes affichés.
- Nouveau groupe **Profil des salariés** : sexe, âge, ancienneté (durée depuis l'embauche).

## 2. Existant

| Élément | Où | Constat |
|---|---|---|
| 8 cartes | `frontend/src/pages/Resume.tsx` l.287-498 | CA, Commissions, Masse salariale, Part des MAD / Marge, Primes, Effectif global, CA par salarié. Grille de 4 (`.cases`, `base.css` l.289). |
| Tableau « Suivi mensuel » | `Resume.tsx` l.267 | Colonnes CA, Marge, % marge, Masse salariale, Commissions, Primes, Frais de mission, Logement site déporté. |
| Préférences par compte | `PreferenceUtilisateur` | Déjà utilisé pour « Personnaliser » ; réutilisé tel quel (clé `affichage.resume`). |
| Données personne | `imports/paie.py` | Civilité, Date de naissance, Date d'embauche **ignorées** à l'import (`etude-import-paie.md` §3a). Nature du contrat est déjà lue. |
| Règles déjà décidées | `etude-filtres-affichage-comparaison.md` §3-4 | Tranches d'âge et d'ancienneté, seuil de 3 personnes sauf `nominatif:read`, masquer n'est pas un droit. |

## 3. Groupes retenus (validés le 27/11)

Références : ISO 30414 (familles d'indicateurs RH : coûts, productivité, effectifs, diversité) et chapitre « Emploi » du bilan social / BDESE. Noms repris du vocabulaire déjà affiché dans l'application.

| Groupe | Cartes | Colonnes du tableau | Référence |
|---|---|---|---|
| Activité et productivité | CA, Marge, CA par salarié | CA, Marge, % marge | ISO 30414 productivité |
| Masse salariale | Masse salariale, Commissions, Primes de productivité | Masse salariale, Commissions, Primes, Frais de mission, Logement | ISO 30414 coûts ; bilan social rémunérations |
| Effectif | Effectif global, Part des MAD, Type de contrat | — | ISO 30414 effectifs ; bilan social emploi |
| Profil des salariés (nouveau) | Sexe, Âge, Ancienneté | — | ISO 30414 diversité ; bilan social structure des effectifs |

4 groupes de 3 cartes, une ligne par groupe (grille de 3). Commissions = rémunération (paie), Type de contrat = composition de l'effectif.

## 4. Options pour le filtre

| Option | Pour | Contre |
|---|---|---|
| **A. Liste à cases dans la barre de filtres, mémorisée par compte** | Même geste que les autres filtres ; un clic | Un filtre de plus dans la barre |
| B. Bouton « Affichage » à part | Sépare filtres de données et affichage | Deux endroits pour régler l'écran |
| C. Onglets par groupe | Écran très léger | Un seul groupe visible à la fois, pas de vue d'ensemble |

**Choix : A.** Par défaut tout est coché. Le choix n'est pas mis dans l'adresse (préférence personnelle, pas un filtre de données). Un rappel « 1 type masqué » évite de croire qu'une donnée manque.

## 5. Calculs (Profil des salariés et Type de contrat) (serveur)

- Base : salariés présents au dernier mois de la période (même base que « Effectif global »), filtre de périmètre dans la couche dépôt.
- Sexe : Civilité M. → H, Mme / Mlle → F.
- Âge et ancienneté : au dernier jour du dernier mois ; moyenne + tranches (âge : <25, 25-34, 35-44, 45-54, 55+ ; ancienneté : <1, 1-3, 3-5, 5-10, 10+ ans).
- Type de contrat : répartition CDI / CDD / autres (donnée déjà importée).
- Valeur absente → « Non renseigné », comptée à part, jamais devinée.
- Moins de 3 personnes et pas de `nominatif:read` → « Sélection trop petite » au lieu des chiffres.
- Comparaison : même calcul sur la période ou la sélection comparée, écart en points.

## 6. Impacts

- Migration : `salarie.sexe` (H / F, déduit de la civilité à l'import ; la civilité brute n'est pas stockée), `salarie.date_naissance`, `salarie.date_embauche` (nullables).
- Import : lecture des 3 colonnes (noms de `etude-import-paie.md`, dates `JJ/MM/AAAA`) ; fichiers déjà importés : « Non renseigné » jusqu'au prochain import.
- Export PDF / Excel : inchangé, garde tout.

## 7. Risques et points ouverts

- Q1 client (noms exacts des colonnes) toujours sans réponse : défauts ci-dessus.
- « Durée du contrat » compris comme l'ancienneté ; la date de fin des CDD n'est pas dans le fichier.

## 8. Menu « Filtrer par » groupé et filtres de profil (35-f)

**Besoin.** Le menu « Filtrer par » (35-e) liste tous les filtres, rangés sous les groupes d'indicateurs, avec trois nouveaux filtres : Sexe, Tranche d'âge, Tranche d'ancienneté. Les cartes ne changent pas.

**Existant.** `ChoixFiltres.tsx` (liste plate), `FiltresPeriode.tsx` (filtres de données, `MultiChoix`), filtres partagés dans l'URL (`filtresPartages.ts`). Côté serveur, `chargement.filtrer` filtre les lignes déjà chargées ; chaque `Ligne` porte `sexe`, `date_naissance`, `date_embauche` (35-b) et la période sa date de fin. « Front / back office » vient de l'Activité du poste (`referentiel.py`).

**Groupes du menu.**

| Groupe | Filtres |
|---|---|
| Activité et productivité | Activité (front / back office) |
| Effectif | Département, Service, Type de site, Site, Contrat |
| Profil des salariés | Poste, Sexe, Tranche d'âge, Tranche d'ancienneté |

Poste décrit le salarié (rangé dans Profil des salariés à la demande de l'utilisateur, 27/11) ; le filtre Poste est proposé sur toutes les pages, Budget réalisé compris. Le groupe Masse salariale n'a pas de filtre.

**Options comparées pour les filtres de profil.**

| Option | Pour | Contre |
|---|---|---|
| A. Filtre serveur dans `chargement.filtrer` (retenue) | Même chemin que Poste / Contrat, périmètre appliqué avant, tous les calculs suivent | Paramètres à ajouter aux routes annuelles |
| B. Filtre en SQL au chargement | Moins de lignes lues | Le chargement est mis en cache par mois et partagé ; âge relatif au mois |
| C. Filtre côté écran | Rien au serveur | Interdit : calculs et filtres côté serveur |

**Règles.**
- Valeurs : sexe `H`, `F` ; âge `<25`, `25-34`, `35-44`, `45-54`, `55+` ; ancienneté `<1`, `1-3`, `3-5`, `5-10`, `10+` ; `nr` = non renseigné (proposé, jamais deviné). Choix multiples « A|B ».
- Âge et ancienneté calculés au dernier jour de **chaque mois** : une personne change de tranche dans l'année comme dans la réalité.
- Comme Poste et Contrat : pas de budget, pas de saisie (CA, marge…) sous un filtre de profil ; la Répartition des charges l'explique (« Budget non suivi par sexe, âge ni ancienneté »).
- Pages : Budget réalisé, Répartition des charges, Graphiques (routes annuelles, exports compris). Pas de mode « Comparer » (R9) pour ces filtres dans ce cycle.
- Le groupe Activité et productivité reste visible sans droit marge : le filtre Activité ne montre aucune marge.

**Risques.** Un filtre très fin (Sexe + Site) peut viser peu de personnes : même situation qu'avec Poste aujourd'hui (droit `report:read`) ; le masquage sous 3 personnes ne couvre que la carte Profil. Point à suivre avec le client, noté au backlog si besoin.
