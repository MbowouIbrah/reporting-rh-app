# Écran Vérification : erreurs détectées, expliquées, corrigeables sur place

Origine : test d'import d'août 2026 (`Downloads/donnees_2026_08.xlsx`, 48 erreurs plantées). Un groupe à la fois : je livre, tu testes avec le fichier, on valide, on passe au suivant.

## Principe commun
- **Trois niveaux** : *À corriger* (bloque l'enregistrement), *À confirmer* (une décision est attendue, une valeur par défaut est proposée), *Corrigé automatiquement* (pour information, refusable).
- **Ancrage** : chaque erreur porte « Ligne N » cliquable, qui ouvre la ligne du fichier avec la cellule fautive surlignée.
- **Actions sur place** : chaque erreur propose ses boutons (ajouter au référentiel, reprendre la valeur enregistrée, garder une ligne…). Les décisions sont gardées dans le lot, les contrôles sont relancés, les compteurs se mettent à jour. Rien n'est écrit en base avant « Enregistrer ».
- **Historique protégé** : un changement (contrat, service…) ne touche que les mois importés ; les mois déjà enregistrés gardent leurs valeurs (chaque mois porte déjà ses propres attributs).

## Groupes, dans l'ordre

**G1. Messages clairs et regroupement** (affichage seul)
- Détail concis et explicite : type attendu (« nombre », « entier de 0 à 31 »), liste des valeurs admises pour un référentiel (« Sites admis : Bertoua, Dehane… »).
- Doublon sur une seule ligne : « EMP046 en double (août 2026) : lignes 40 et 41 ».
- Nom de l'employé sur chaque erreur, notamment les changements d'affectation.
- Niveaux et ancrage vers la ligne ; plus de rubrique « Autres points » (chaque code a son groupe).

**G2. Lecture plus tolérante et modèle** — livré (codes `ERREUR_EXCEL`, `FORMULE_SANS_VALEUR`, `SANS_MONTANT`, avertissements). La valeur par défaut (vide) s'applique d'office ; la correction sur place permet de saisir le montant. Les boutons de décision (« Ignorer (vide) ») arrivent avec le socle G3.
- `#N/A`, `#REF!`… : cellule traitée comme vide, signalée pour information.
- Formule : la valeur calculée par Excel est déjà lue. Si le fichier n'a pas de valeur calculée (fichier produit par un outil, ou jamais ouvert dans Excel) : *À confirmer*, avec la consigne « ouvrir et enregistrer dans Excel, ou copier puis Collage spécial › Valeurs ».
- `-`, `/`, `néant`, `n/a`, `x`… dans un montant : plus bloquant, *À confirmer* avec l'action « Ignorer (vide) ».
- Référentiels : liste déroulante dans le modèle mais collage libre accepté (alerte Excel en simple avertissement) ; casse ignorée, la valeur de référence est reprise telle quelle.

**G3. Socle des décisions + erreurs bloquantes** — livré : décisions gardées dans le lot, liste « Choisir une solution… » par point, vérification en direct, point réglé en vert, « Annuler ce choix ». Reste (retours du 19/10) :
- Doublon : un seul en-tête, les deux lignes dans le même tableau (ordre du fichier) ; options « Garder la ligne 40, supprimer la ligne 41 » et l'inverse.
- Point sans autre solution que la saisie (absences hors bornes, montant illisible…) : texte par défaut « Veuillez saisir une valeur conforme ».
- Messages en phrases complètes, partout (ex. « Le service de Didier Nkolo passe de SAV PL (juillet 2026) à Commerce Pièces (août 2026) : mutation ou erreur ? »).
- Ligne dépliée : défilement pour la placer juste sous l'en-tête du tableau, les lignes suivantes restant accessibles.
- Barre d'actions compacte : « Choisir un autre fichier » à côté de « Télécharger le rapport », même forme ; « Annuler les changements » et « Enregistrer » en bas à droite, à sa place.
- « Enregistrer » applique les décisions au fichier et relance toute l'analyse ; les points restants s'affichent. On n'avance que lorsque tous les points sont réglés (« Ignorer la valeur » compte comme une solution). Plus tard : avancer avec des points seulement « à confirmer ».

**G4. Formules et liaisons, contrôlées avant tout** : le fichier est d'abord examiné ; s'il contient une formule sans valeur utilisable, il est refusé avant toute correction, avec la raison et la marche à suivre.
- Ce que l'application lit : la valeur qu'Excel a calculée et enregistrée dans le fichier, jamais la formule. Une formule interne (=B2+C2) ou une liaison vers un autre fichier ne pose donc aucun problème si la valeur enregistrée est bonne.
- Refus, cellule par cellule (ligne, colonne, formule) :
  - liaison vers un autre fichier dont la valeur est une erreur (#REF!, fichier source introuvable au dernier calcul) ;
  - formule sans valeur calculée (fichier produit par un outil, ou jamais ouvert dans Excel) ;
  - formule en erreur (#N/A, #DIV/0!…).
- Liaison avec une valeur correcte : acceptée, avec une information « valeurs lues telles qu'Excel les a calculées à la dernière ouverture : vérifier que le fichier source était à jour ».
- Marche à suivre affichée (simple, valable pour toutes les versions) :
  1. Ouvrir le fichier dans Excel, avec le fichier source accessible ; accepter « Mettre à jour les liaisons » ; enregistrer ; réimporter. Le fichier garde ses liaisons et continue d'évoluer.
  2. Si le fichier source n'est plus accessible : « Enregistrer sous » une copie pour l'import, sélectionner les cellules, Copier puis Collage spécial › Valeurs (LibreOffice : Collage spécial › Valeurs seulement ; Google Sheets : Ctrl+Maj+V). Le fichier d'origine garde ses formules.
- Remplace le traitement de G2 (`ERREUR_EXCEL`, `FORMULE_SANS_VALEUR` passent de « à confirmer » à refus du fichier).

**G5. Lecture intelligente des valeurs saisies** : intention évidente devinée et proposée (« Corriger en 1 250 000 ») ; toutes les valeurs affichées au même format (espace pour les milliers, virgule pour les décimales).
- Points comme séparateurs de milliers (« 1.250.000 ») ; cas ambigu (« 45.000 ») : deux solutions, « 45 000 (point = milliers) » ou « 45 (point = décimale) », avec l'explication.
- Devise ou unité collée (« 25 000 FCFA », « 25000 F », « XAF », « jours ») : « Corriger en 25 000 ».
- Espaces en trop au début, à la fin ou en double (texte et référentiels) ; virgule décimale ; casse ou accent différents d'une valeur de la liste.
- Messages précis : « 138 700,4853 a 4 décimales ; les montants gardent 3 décimales : 138 700,485 » (information, refusable).

**G6. Valeurs obligatoires vides** : solutions proposées dans la liste.
- « Reprendre la valeur du mois précédent (CDD, juillet 2026) » quand l'employé est connu.
- ANNÉE ou MOIS vide : proposer la valeur des autres lignes du fichier (toutes en août 2026 → « Août »), sinon la liste des valeurs présentes sur les lignes justes.
- Ligne de total ou ligne parasite (« TOTAL », formules =SUM) : « Supprimer la ligne ».

**G7. Changements d'affectation** : phrase complète par employé nommé ; « Changement à partir de ce mois » ou « Erreur : garder <valeur enregistrée> ».

**G8. Noms et matricules** :
- Matricule douteux (« 20 », « emp046 ») : recherche rapide parmi les employés connus (index par chiffres du matricule et par nom) ; « C'est Noel Essomba (EMP020) : reprendre son matricule ».
- Nom proche d'un autre employé : « C'est <nom> (EMPxxx) : remplacer par cet employé » ou « Personne différente ».
- Même matricule, nom différent : « Garder le nom enregistré » / « Mettre à jour le nom ».

**G9. Nouvelles valeurs (poste, site, service…)** : jamais créées sans validation explicite (« Créer le poste … » ou « Remplacer par <valeur la plus proche> ») ; une seule ligne par valeur, avec le nombre de lignes concernées (« Agent logistiquee : 3 lignes »).

**G10. Valeurs corrigées automatiquement** : « Conserver » / « Refuser » par ligne, « Tout conserver ». Refuser remet la valeur d'origine en *À corriger*.

**G11. Montants** : montant négatif « Régularisation confirmée » / corriger.

**G12. Contrôles manquants** (backlog B-017) : MOIS ou ANNÉE différents du mois choisi, montant ×10 ou en milliers par rapport au mois précédent, Brut Réel ≠ somme, ligne sans aucun montant, nouvel employé sans matricule.

**G13. Rapport Excel annoté** : le fichier d'erreurs reprend le fichier importé, lignes et cellules en cause surlignées (rouge à corriger, orange à confirmer) avec le message en commentaire.

Règle pour tous les groupes : chaque point propose au moins une solution dans la liste ; la saisie libre reste toujours possible.
