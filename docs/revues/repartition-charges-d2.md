# Revue : Répartition des charges, proposition d2 (38.6)

Livrables revus : `docs/maquettes/reunion-17-11/charges-v3.html` (M, retirée le 19/11 au profit de `charges-v4.html`), `docs/etude-repartition-charges.md` (E), `docs/etude-retours-reunion-17-11.md` (R).
Passe 1 : auditeur, 33 écarts (3 bloquants, 13 importants, 17 mineurs). Passe 2 (contre-revue) : 13 écarts nouveaux ou rouverts, aucun bloquant (n° 34 à 46).

| N° | Fichier | Classe | Correction | Statut |
|---|---|---|---|---|
| 1 | M tableEffectifs, E § 7 Section | Formule différente du cadrage | Absentéisme = absences ÷ (effectif fin × 22 × N mois), 22 = paramètre « jours ouvrés » (P0, `moteur.py`) | corrigé |
| 2 | M note hors total, E § 2 | Règle mal justifiée | « Hors total par la règle de paie datée : composantes du Brut Réel ou sorties du total sur décision client (F7) » | corrigé |
| 3 | M `cols()` et lignes N-1, E § 7 États | État sans affichage | Période comparée sans donnée : N-1, variation, % = « — » (lignes, total, personnes, sous-total) | corrigé |
| 4 | E l.3, § 7 | Renvoi de décision faux | « Variante B, puis personnes dépliées sous la ligne (décision 18/11) » | corrigé |
| 5 | R § R10-R13, E § 4 | Document source périmé | Renvoi dans R vers E ; liste des écarts avec R10-R13 dans E § 4 | corrigé |
| 6 | M carte Toutes les charges, E § 7 Période | Deux comparaisons sans note | Note : la case Primes compare à N-1 même mois, la ligne du tableau au mois d'avant | corrigé |
| 7 | M écart d'effectif, E § 7 Effectif | Valeur incohérente entre vues | Écart = recrutements − départs (même source que le tableau Effectifs) ; arrondi unique par personne | corrigé |
| 8 | E § 4 | Affirmation fausse | « Rien n'est perdu » retiré ; ce qui n'est pas repris listé en § 6 Non retenu | corrigé |
| 9 | E § 5 | Contrat d'API incomplet | Contenu de `/rapports/charges` : Primes, budget et raison, effectif et écart, % FO, section Effectifs et activité | corrigé |
| 10 | M `IND`, E § 7 Section | Règle sans source serveur | Objectifs OR et Devis retirés ; seuls `OBJECTIFS_ACTIVITE` + masse salariale par vente (budget ÷ objectif ventes) | corrigé (complété au n° 35) |
| 11 | E § 7 Budget | Règle incomplète | Lignes Type de site, Poste, sites, Département, Salarié dans le tableau ; règle `charger_budgets` citée. Maquette : ces filtres y sont figés, rien à changer dans `dispo()` | corrigé |
| 12 | E § 7 Budget | Règle sans écrit | « Total d'une famille : budget seulement si chacune de ses lignes en a un » | corrigé |
| 13 | M barre de filtres, E § 7 Filtres | Filtres de l'appli absents | Département, Poste, Salarié ajoutés (figés) ; note dans E | corrigé |
| 14 | E § 7 Accès | Décision contraire au cadrage (D4) | Décision utilisateur du 18/11, déjà marquée « à reconfirmer avec le client » | rejeté (décision utilisateur, reconfirmation écrite en E § 7 et en passation) |
| 15 | M calendrier | Accessibilité : état non exposé | `aria-pressed` et `aria-label` « oct. 2026 » sur chaque mois | corrigé |
| 16 | M tri | Annonce périmée | « Tri retiré : colonne absente de cette vue » | corrigé |
| 17 | M liste des personnes | Libellé faux | Le libellé dit le tri réellement appliqué | corrigé |
| 18 | M notes | Note hors contexte | « Ne s'additionne pas » seulement en vue Type de charge | corrigé |
| 19 | M tableEffectifs | En-tête faux | « Répartition », groupes « Par nature de contrat » / « Par activité » | corrigé |
| 20 | M toast PDF | État sans affichage | Contenu propre à l'état vide | corrigé |
| 21 | M note budget | Valeur fictive non signalée | Budget par salarié marqué fictif (paramètre dans l'appli) | corrigé |
| 22 | M tableEffectifs | Valeur fictive non signalée | Note « effectifs fictifs, identiques quelle que soit la période » | corrigé |
| 23 | M onglets | Accessibilité : lien onglet/panneau | `id`, `aria-controls`, `role="tabpanel"`, `aria-labelledby` | corrigé |
| 24 | M tableau principal | Accessibilité : zone défilante | `tabindex="0"` sur le panneau défilant | corrigé |
| 25 | M filtre Contrat | Libellé / classe divergents | Libellé « Contrat » comme l'appli ; classe `souple` erronée, reprise au n° 36 | corrigé (n° 36) |
| 26 | M données, BUD_RUB | Libellé différent de la base | « Brut Réel » partout | corrigé |
| 27 | M section Activité, E § 7 | Libellé différent du serveur | Libellés de `LIGNES_ACTIVITE` | corrigé |
| 28 | E § 4 | Deux règles pour un même état | « Italique » (et non « hachurées ») | corrigé |
| 29 | E § 1 | Terme non unifié | « Variation » au lieu de « écart » pour N − N-1 | corrigé |
| 30 | E § 6 | Doublon | Risque « exclusion en cours de période » gardé une fois | corrigé |
| 31 | E § 7 Hiérarchie | Texte différent de la maquette | Texte exact des notes recopié (en entier au n° 41) | corrigé |
| 32 | E § 7 | Non maquetté non signalé | Compte sans nominatif et « Voir le dernier mois importé » marqués non maquettés | corrigé |
| 33 | E § 7 Hiérarchie | État sans règle | Variation nulle : 0 sans signe ni couleur | corrigé |
| 34 | E § 7 Budget | Règle fausse | Poste passe avec Contrat et Employé : pas de budget total (`rapports.py` `_params`) | corrigé |
| 35 | E § 5, § 7 Section | Règle sans code | Objectif de masse salariale par vente : nouveau calcul serveur à l'étape e, gardé par défaut | corrigé |
| 36 | M barre de filtres | Classe divergente de l'appli | `souple` retiré de Contrat, ajouté à Département, Poste, Employé (comme `FiltresPeriode.tsx`) | corrigé |
| 37 | M, E § 7 Filtres | Libellé différent de l'appli | « Salarié » → « Employé », ordre de l'appli (… Activité, Contrat, Poste, Employé) | corrigé |
| 38 | E § 7 Filtres | Renvoi faux | « onglets grisés : règle ci-dessus » | corrigé |
| 39 | E § 7 États | Règle incomplète | Filtre Activité de la liste masqué aussi quand le filtre Activité de la barre est actif | corrigé |
| 40 | E § 7 Période, Filtres | État sans règle | « Comparer à » figé dans la maquette ; comparaison choisie = suivie partout, case Primes comprise | corrigé |
| 41 | E § 7 Hiérarchie | Texte différent de la maquette | Note hors total recopiée en entier | corrigé |
| 42 | E § 5 | Contrat d'API incomplet | `controles` (période d'un mois) dans le contenu de `/rapports/charges` | corrigé |
| 43 | M notes, E § 7 États | État sans affichage | Comparaison en partie avant les données : calcul sur les mois importés, note « Comparaison partielle » (tableau et onglet Activité) | corrigé |
| 44 | docs/QUESTIONS_CLIENT.md D4 | Décision non tracée | Décision provisoire du 18/11 notée, à reconfirmer | corrigé |
| 45 | M `sens`, `cols`, `fp`, `pts` | Couleur ≠ valeur affichée | Couleur et signe selon la valeur arrondie, un seul seuil (0,05 %) | corrigé |
| 46 | M `champ` | Seuil différent de la règle | Recherche dès 10 personnes (`>= 10`) | corrigé |

Contre-revue : passe 2 (auditeur) non conforme sans bloquant ; les 13 écarts (n° 34 à 46) corrigés et vérifiés (grep, script Playwright : 0 débordement, 0 axe, 0 erreur JS). Pas de 3e passe (plafond).
