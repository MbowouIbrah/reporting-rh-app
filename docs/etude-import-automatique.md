# Étude : import automatique depuis un dossier surveillé (13/11)

Demande de l'utilisateur, ajoutée à l'import direct de l'export de paie (E8, `BrutFinal1026.CSV`). Décisions du 13/11 intégrées (§ 8). Reste une question au client : le mois d'un fichier.

## 1. Besoin

1. Le chemin d'un dossier (partage réseau) est donné dans `.env`. L'appli détecte seule un fichier nouveau ou modifié, sans relire le dossier en boucle.
2. Un fichier par mois (cas retenu). Un fichier cumulatif est traité par la même règle.
3. L'appli lit, contrôle, met de côté ce qui est correct et prévient l'admin de chaque problème.
4. Les nouvelles données restent **invisibles pour tous** tant que les problèmes ne sont pas réglés.
5. Une ligne d'un mois déjà entré qui revient avec des changements devient un problème : **Remplacer** ou **Laisser tel quel**.
6. Élément inconnu (département, service, employé…) : bouton « Ajouter comme nouveau … » ou « Rattacher à … ».
7. Quand tout est réglé : aperçu du mois seul, puis l'admin le rend disponible. Option : publication automatique.
8. Notifications : l'admin (fichier reçu, problèmes, publication) ; chaque utilisateur quand de nouvelles données le concernant sont disponibles, dans l'appli, avec l'option « me prévenir aussi par e-mail ».
9. L'ancien import (dépôt manuel) est mis de côté, **sans suppression**.
10. Le partage réseau n'est pas encore accessible : la livraison se fait sur un dossier simulé.

Parcours :

```
[1 Détection]  →  [2 Lecture + analyse + alerte admin]  →  [Problèmes réglés]  →  [Aperçu du mois]  →  [Disponible + notifications]
  automatique             automatique                        par l'admin          admin (ou auto)        automatique
```

## 2. Existant réutilisable

| Élément | Où | Réutilisation |
|---|---|---|
| Lot d'import (fichier, sha256, statut `pret / rejete / valide / annule`) | `backend/app/models/imports.py:24` | Gardé ; ajouter l'origine (`depot` / `dossier`), le chemin, le mois, le statut `en_attente`. |
| Mise de côté (staging), jamais lue par les tableaux | `StagingLigne`, `service.analyser()` `:131` | C'est déjà « invisible tant que non validé ». |
| Problèmes par ligne / colonne | `ImportAnomalie`, `regles.valider()` | Gardé ; règles du CSV de paie en plus. |
| Corriger / retirer une ligne, décisions en lot | `service.corriger_ligne` `:384`, `retirer_ligne` `:438`, `appliquer_decisions` `:311` | Gardé. |
| Garder la ligne déjà en base au lieu de celle du lot | `valider_lot(..., garder=)` `:855` | Base du choix « Laisser tel quel ». |
| Ajouter une valeur inconnue (créée à la validation) | `service.ajouter_referentiel` `:412` | Étendu aux départements (E7), employés, rubriques. |
| Rattacher à une valeur connue | `RefAlias` (`models/referentiel.py:57`) | Ajouter `departement`. |
| Comparaison avec la base | `service.apercu()` `:774` | Sert aux lignes changées (§ 4) et à l'aperçu. |
| Annulation d'un lot validé | `LotImportPrecedent`, `annuler_lot` `:1008` | Gardé. |
| Mail | `app/mail.py` (`SMTP_HOST` vide = pas d'envoi) | Mails seulement si SMTP est réglé. |
| Abonnement e-mail + envoi unique par version + désabonnement par lien signé | Precis Translator : `api/nouveautes.py`, `models/nouveautes_envoi.py`, `User.abonne_nouveautes` | Même modèle (§ 6). |
| Notification dans l'appli | **aucune** | À créer. |

## 3. Détection : à l'événement, pas en boucle

| Option | Pour | Contre |
|---|---|---|
| A. Relire le dossier à intervalle fixe | Simple | Travail inutile 99 % du temps ; délai ; jugée non optimale |
| **B. Avis de changement du système + passage de secours rare** | Rien ne tourne tant que rien ne change ; réaction en secondes ; marche sur partage réseau (Windows transmet l'avis du serveur de fichiers) | Une dépendance (`watchdog`) ; un avis peut se perdre si le réseau coupe, d'où le passage de secours |
| C. Tâche planifiée Windows | Hors du serveur web | Réglage de plus sur le serveur ; reste une boucle |

**Choix : B.**
- Une tâche de fond démarrée avec l'API (`lifespan`) s'abonne aux avis du dossier `IMPORT_DOSSIER` (création, modification, renommage).
- **Attente de stabilité** : un fichier n'est lu que 30 s après son dernier avis (une copie en cours envoie plusieurs avis).
- **Passage de secours** au démarrage puis toutes les 30 min : il ne lit que la liste (nom, taille, date), jamais le contenu. Il rattrape un avis perdu (coupure réseau, redémarrage).
- Contenu lu seulement si taille ou date ont changé ; sha256 identique à un lot déjà traité → ignoré.
- Un seul lecteur à la fois (verrou en base), même avec plusieurs processus API.
- Dossier absent ou inaccessible : une alerte admin (une seule tant que la panne dure), reprise seule au retour.
- **Simulation** (partage pas encore accessible) : `IMPORT_DOSSIER` pointe sur un dossier local ; un script `tools/import_simule.py` y dépose, modifie ou remplace des fichiers de paie fictifs (un par mois, modification d'un mois validé, fichier illisible) pour tester tout le parcours. Le jour venu, seul le chemin change.

Réglages `.env` : `IMPORT_DOSSIER` (vide = détection coupée), `IMPORT_STABILITE` (30 s), `IMPORT_SECOURS` (30 min).

## 4. Fichier par mois et lignes changées

| Cas | Traitement |
|---|---|
| Nouveau fichier (nouveau mois) | Nouveau lot `en_attente`. |
| Fichier modifié **avant** publication | Nouveau lot ; l'ancien lot en attente du même fichier est annulé (trace « remplacé par »). Les valeurs ajoutées aux listes sont reprises si le nouveau fichier les cite encore. Corrections et choix par cellule ne sont pas repris : les lignes du fichier ont pu bouger (`service._remplacer_version`, 13/11). |
| Fichier modifié **après** publication, ou cumulatif | Nouveau lot. Lignes identiques à la base : ignorées. Ligne changée sur un mois déjà publié : volet « Lignes à mettre à jour » de l'aperçu (déjà en place), avec l'ancien et le nouveau montant côte à côte, et deux boutons **Remplacer** / **Laisser tel quel** (par ligne, ou pour toutes les lignes du fichier). Jamais d'écrasement en silence. |
| Fichier supprimé du dossier | Aucun effet sur les données. Alerte si un lot en attente venait de ce fichier. |

**Mois du fichier : question au client** (§ 8). Le modèle n'a pas de colonne mois. En attendant : mois lu dans le nom (`…MMAA`) ; sinon problème « Mois à préciser », l'admin le choisit.

## 5. Publication

- **Statuts** : `en_attente` (au moins un problème) → `pret` (dernier problème réglé) → `valide` (disponible). Seules les données `valide` sont lues par les tableaux (déjà le cas).
- **Aperçu du mois** : quand le lot est `pret`, l'admin ouvre un aperçu avec **seulement les données de ce mois** (mêmes tableaux Mensuel que les utilisateurs, calculés sur le lot), puis clique **Rendre disponible**.
- **Publication automatique** (réglage admin, coupé par défaut) : un lot sans problème, ou dont le dernier problème vient d'être réglé, est rendu disponible sans clic. L'admin reçoit quand même la notification « Octobre 2026 publié » et peut annuler le lot.
- Un mois à moitié publié fausserait les totaux : on publie tout le lot ou rien.

## 6. Notifications

**Table `notification`** : destinataire, type, titre, texte, lien, lot, créée le, lue le. Cloche dans l'en-tête avec le nombre non lu ; liste ; « tout marquer comme lu ».

| Destinataire | Quand | Canal |
|---|---|---|
| Admins | Fichier reçu ; problèmes trouvés (nombre, lien vers la liste) ; lot prêt pour l'aperçu ; publié ; dossier inaccessible | Appli + e-mail si SMTP |
| Chaque utilisateur | Données d'un mois rendues disponibles **dans son périmètre** (« Les données d'octobre 2026 sont disponibles ») ; une seule par mois, même si le mois est republié | Appli ; e-mail s'il l'a demandé |

**Option « Me prévenir aussi par e-mail »** dans le profil, coupée par défaut, comme l'abonnement aux nouveautés de Precis Translator :
- `utilisateur.notif_mail` + date d'abonnement ;
- registre des envois (utilisateur, mois) avec contrainte d'unicité : jamais deux mails pour le même mois ;
- lien de désabonnement signé dans chaque mail (le lien ouvre une page, seul le bouton désabonne : les antivirus de messagerie suivent les liens) ;
- « ou autre » : le canal est un champ (`appli`, `mail`), un canal de plus (Teams…) s'ajoute sans changer le reste.

## 7. Ancien import mis de côté

- `IMPORT_MODE` dans `.env` : `dossier` ou `depot`. En `dossier`, le dépôt manuel est masqué du menu ; code, routes et tests restent. Les anciens lots restent consultables et annulables.
- Suppression de l'ancien seulement après validation du nouveau (double run G2).

## 8. Décisions

| # | Point | Décision |
|---|---|---|
| 1 | Mois d'un fichier | **Question au client** (`QUESTIONS_CLIENT.md`). En attendant : lu dans le nom, sinon choisi par l'admin. |
| 2 | Publication | **Décidé (13/11)** : aperçu du mois seul, puis l'admin rend disponible ; publication automatique en option (coupée par défaut). |
| 3 | Mois déjà entré qui change (fichier modifié ou cumulatif) | **Décidé (13/11)** : problème à régler, Remplacer ou Laisser tel quel. |
| 4 | Dossier | **Décidé (13/11)** : partage réseau ; pas encore accessible, livraison sur dossier simulé. |
| 5 | Détection | **Décidé (13/11)** : à l'événement, pas en boucle (option B). |
| 6 | Notifications | **Décidé (13/11)** : admin et utilisateurs, dans l'appli ; e-mail sur abonnement. |

Points déjà en attente qui pèsent ici : C4 (front / back office absent du CSV), site = établissement ou unité (E8), départements (E7), fichier MAD (structure à venir), SMTP (non réglé : les e-mails partiront quand il le sera).

## 9. Impacts et risques

- **Base** : une migration (lot : statut `en_attente`, origine, chemin, mois ; tables `notification` et `notification_envoi` ; `utilisateur.notif_mail` ; réglage publication automatique ; dimension `departement` dans les alias).
- **Dépendance** : `watchdog` (backend seulement). La version de test n'est pas touchée tant qu'on ne la met pas à jour.
- **Sécurité** : chemin du dossier seulement dans `.env`, jamais affiché aux non-admins ; dossier lu en lecture seule ; taille maximale gardée ; une notification utilisateur ne donne que le mois, jamais un montant ; le lien de la notification passe par les droits habituels.
- **Performance** : rien ne tourne entre deux changements ; passage de secours = une liste de fichiers toutes les 30 min.
- **Risques** : avis perdus (passage de secours) ; deux fichiers pour le même mois (le second devient un problème « mois déjà en attente ») ; encodage (UTF-8 puis Latin-1, comme `lecture.py`) ; trop de mails (un par mois et par personne au plus).

## 10. Plan de réalisation

1. Lecture du CSV de paie + correspondance des colonnes (E8, comparaison avec l'import actuel déjà prévue).
2. Départements (E7) : liste, service rattaché, alias.
3. Lot automatique : statut `en_attente`, mois, problème « Données déjà entrées modifiées » (Remplacer / Laisser tel quel).
4. Détection : avis du dossier, stabilité, passage de secours, verrou ; script de simulation.
5. Aperçu du mois + Rendre disponible + publication automatique en option.
6. Notifications : table, cloche, admin et utilisateurs, option e-mail, registre, désabonnement.
7. Boutons « Ajouter / Rattacher » pour département, employé, rubrique.
8. `IMPORT_MODE` : ancien import masqué, pas supprimé.
9. Tests unitaires + recette sur le dossier simulé, puis double run (G2).
