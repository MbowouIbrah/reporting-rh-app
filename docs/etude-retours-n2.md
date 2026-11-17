# Étude : retours de la réunion N2 (notes du 13/11/2026)

Source : `docs/retours/RETOURS_N2.md` (points 2 à 9). Cette étude dit comment chaque point entre dans l'appli,
ce que j'ai choisi, et ce qui reste à confirmer par le client.

## 1. Besoins

| # | Demande | Ce que je comprends |
|---|---|---|
| a | Ratio productifs / administratifs, en % | % front office et % back office de l'effectif (les deux activités de l'appli) |
| b | Service SAV Chariot | Un service de plus |
| c | % front / back d'un service, % de l'effectif du service sur l'effectif global | Colonnes de parts dans « Répartition par service » |
| d | Même chose par agence | « Répartition par site » présentée comme celle des services, avec les mêmes parts |
| e | Matricule pour tous (MAD compris) | Import plus sûr : une ligne sans matricule bloque |
| f | Graphiques exportés « vivants » (Excel, PowerPoint, autres) | Vrais graphiques Office, modifiables, avec leurs données |
| g | Winpart, Motul, Autofast ; DOP Nicolas : vue globale (Winpart compris) ; l'autre DOP : seulement Equipment (Motors plus tard, Equipment, Winpart) | Trois services de plus, deux périmètres de plus |

## 2. Existant

- Services, sites, activités, contrats : tables de référence, remplies par `app/referentiels_init.py` et par migrations.
- Périmètres : `perimetre` + `perimetre_regle` (liste de services), éditables en données ; un compte peut avoir
  plusieurs portées (`utilisateur_portee` : tout, périmètre, service, site). Le filtre est appliqué dans la couche dépôt.
- KPI : `app/kpi/moteur.py`, `mensuel()` et `annuel()` renvoient `synthese`, `b_service_activite`, `c_site`.
  Les pourcentages circulent en ratio (0,05 = 5 %) et le front les affiche avec `pct()`.
- Import : sans matricule, un identifiant `SM-…` est déduit du nom (`app/imports/regles.py:108`).
- Graphes : page `frontend/src/pages/Graphes.tsx` (Recharts), séries tirées de l'annuel ; export PDF (image) existant.
- Excel : `openpyxl` déjà installé, il sait écrire des graphiques natifs. Pas de `python-pptx`.
  Excel et PowerPoint 16 sont installés sur le poste de dev : les fichiers produits peuvent être ouverts pour preuve.

## 3. Choix

### a. Ratio front / back office
- `synthese.front_back` = effectif fin de mois en front office, en back office, et leurs parts de l'effectif total.
  Annuel : sur le dernier mois avec données. Une ligne sans activité ne compte dans aucune des deux parts.
- Une tuile KPI « Front / Back office » sur Mensuel et Annuel (ex. 62,0 % / 38,0 %).

### b, g. Nouveaux services et périmètres (migration 0025)
| Option | Pour | Contre |
|---|---|---|
| **Winpart, Motul, Autofast = services** (comme Pneumatique) | Rien de neuf dans le modèle ; filtres, droits, tableaux et imports marchent tout de suite | Pas de niveau « BU » au-dessus des services |
| Nouvelle dimension « BU / société » | Colle à une structure de groupe | Migration lourde, imports à revoir ; E4 reporté au backlog par le client |

Choix : services. La notion de BU est rendue par les **périmètres** (groupes de services, déjà en place) :
- `SAV Chariot` : service productif (comme SAV PL, SAV Engins), ajouté au périmètre DPS.
- `Winpart`, `Motul`, `Autofast` : services non productifs.
- Périmètre **Equipment** = Commerce Pièces, SAV PL, SAV Engins, SAV Chariot, Sites Déportés, Pneumatique.
- Périmètre **Winpart** = Winpart, Motul, Autofast.
- Motors (Commerce VN) : plus tard, comme demandé.
- DOP Nicolas : portée « tout ». L'autre DOP : portées Equipment + Winpart. Ce sont des réglages de compte (admin).

### c, d. Parts d'effectif par service et par site
- Base : effectif de fin de mois (annuel : dernier mois avec données). Le « global » = tout le périmètre visible.
- Serveur : chaque activité d'un service ou d'un site reçoit `part` (effectif activité / effectif du service ou du site) ;
  chaque service ou site reçoit `part_globale` (son effectif / effectif global).
- Écran : deux colonnes en fin de tableau, « % du service » (ou « % du site ») sur les lignes Staff, et
  « % global » fusionné par bloc comme le budget. Un bouton « Parts d'effectif » les masque ou les montre (visibles par défaut).
- Sites : même présentation que les services (masse salariale + Staff par activité, détail par contrat au clic).

### e. Matricule obligatoire
- Une ligne sans matricule est **bloquante** : « Matricule manquant : chaque employé, MAD compris, doit avoir son matricule ».
- Plus de création d'identifiant `SM-`. Les fiches `SM-` déjà en base restent lisibles.

### f. Graphiques modifiables
| Option | Pour | Contre |
|---|---|---|
| **Excel (.xlsx) : un onglet par graphique, données + graphique natif** | Modifiable dans Excel, Google Sheets, LibreOffice ; `openpyxl` déjà là | — |
| **PowerPoint (.pptx) : une diapositive par graphique, graphique natif avec son classeur intégré** | « Modifier les données » marche dans PowerPoint ; Google Slides l'ouvre | Pas de bibliothèque installée : fichier construit à la main (XML du graphique produit par `openpyxl`) |
| `python-pptx` | Plus simple à écrire | Nouvelle dépendance à installer aussi sur la version de test |
| **Copier les données** (par graphique, collable dans Excel ou dans la feuille de données d'un graphique Office) | Le plus rapide pour un seul graphique | Pas le graphique lui-même |
| Image (PDF actuel) | Déjà là | Pas modifiable |

Choix : Excel + PowerPoint natifs + « Copier les données ». Le front envoie les graphiques affichés (titre, mois, séries,
type barres ou courbe, unité) ; le serveur les met en forme sans recalculer ni lire de données. Taille bornée.
Google Sheets / Slides, LibreOffice : ouvrent les mêmes fichiers (pas de format en plus).

### h. Lignes de la répartition par site et par service (remarque 3, maquette D1 sobre)

Avant : deux lignes par activité (masse, puis Staff), badges répétés, colonnes vides, « -0 », contrats à 0 affichés.
Maquettes A à D comparées (`C:/tmp/maquettes-lignes/`) ; retenu : **D1 sobre**.

- Une ligne par activité : masse (N-1, N, écart, écart %, part) et effectif (N-1, N, écart, part) côte à côte.
- Détail par contrat replié sous chaque activité (serveur : `contrats` par activité, parts dans l'activité).
- Total site / service en fin de bloc ; il porte le budget (pas de colonnes vides sur les activités).
- Activités et contrats tout à 0 masqués ; « -0 » ne s'affiche plus ; écart nul en gris, baisse en rouge.

Décidé par défaut : une seule activité ouverte à la fois ; ligne TOTAL GÉNÉRAL en bas ; un ancien rapport
sans ventilation par activité se réduit à son total.

### i. Activité en 4e, répartition par nature de contrat (retour du 17/11)

Besoin : tableau Activité trop simple, à placer avant la répartition par contrat ; la répartition par contrat
doit suivre la structure des répartitions site / service (masse et effectif côte à côte).

- Ordre : 1 global, 2 sites, 3 services, **4 Activité**, 5 Répartition par nature de contrat, 6 Analyse des effectifs.
- Activité : indicateurs groupés par thème (Commercial, Atelier, Productivité, Coût RH), ratios ajoutés
  (ventes par client, taux de transformation, masse salariale par vente), groupes « Réalisé » / « Objectif »
  sur la ligne bleue, taux de réalisation avec jauge (calculé serveur : ventes / objectif).
- Contrats : composant `Repartition` réutilisé (axe contrat) ; masse et effectif par activité, parts, total ;
  calcul côté serveur (`d_contrat.blocs`). Ancien rapport sans `blocs` : ancien rendu conservé.

Décidé par défaut : noms de feuilles de l'export xlsx inchangés.

## 4. Impacts et risques
- Données : migration 0025 (4 services, 2 périmètres, DPS complété) ; descente = suppression si non utilisés.
- Import : des fichiers qui passaient (sans matricule) seront refusés ; voulu par le client.
- Sécurité : la route d'export ne lit aucune donnée, exige une session, et borne le nombre de graphiques et de points.
- PowerPoint fait main : risque de fichier refusé, levé en l'ouvrant avec PowerPoint pendant la vérification.

## 5. À confirmer par le client (déjà en place par défaut)
1. Winpart, Motul et Autofast sont bien des services (et non des sociétés à part dans la paie).
2. L'autre DOP voit Equipment **et** Winpart (lecture de « motor plus tard, equipment, winpart »).
3. Le contenu du périmètre Equipment (liste ci-dessus).
