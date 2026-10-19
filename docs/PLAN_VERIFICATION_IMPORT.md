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

**G2. Lecture plus tolérante et modèle**
- `#N/A`, `#REF!`… : cellule traitée comme vide, signalée pour information.
- Formule : la valeur calculée par Excel est déjà lue. Si le fichier n'a pas de valeur calculée (fichier produit par un outil, ou jamais ouvert dans Excel) : *À confirmer*, avec la consigne « ouvrir et enregistrer dans Excel, ou copier puis Collage spécial › Valeurs ».
- `-`, `/`, `néant`, `n/a`, `x`… dans un montant : plus bloquant, *À confirmer* avec l'action « Ignorer (vide) ».
- Référentiels : liste déroulante dans le modèle mais collage libre accepté (alerte Excel en simple avertissement) ; casse ignorée, la valeur de référence est reprise telle quelle.

**G3. Socle des décisions + erreurs bloquantes**
- Référentiel inconnu (`Kribi`) : « Ajouter aux sites » ou « Remplacer par… » (liste).
- Valeur obligatoire vide : « Reprendre la valeur enregistrée (CDD, juillet 2026) ».
- Doublon : « Garder la ligne 40 » / « Garder la ligne 41 ».
- Montant illisible, absences hors bornes : saisir la valeur dans l'écran.

**G4. Changements d'affectation** : « Changement à partir de ce mois » ou « Erreur : garder <valeur enregistrée> », par employé nommé.

**G5. Noms à vérifier** : « Même personne, garder le nom enregistré » / « Mettre à jour le nom » ; pour un nom proche d'un autre employé : « C'est <nom> (EMPxxx) : reprendre son matricule » ou « Personne différente ».

**G6. Valeurs corrigées automatiquement** : « Conserver » / « Refuser » par ligne, « Tout conserver ». Refuser remet la valeur d'origine en *À corriger* (ex. « 45.000 » lu 45).

**G7. Montants et référentiels** : montant négatif « Régularisation confirmée » / corriger ; poste nouveau « Créer le poste » ou « Remplacer par <poste le plus proche> ».

**G8. Contrôles manquants** (backlog B-017) : MOIS ou ANNÉE différents du mois choisi, montant ×10 ou en milliers par rapport au mois précédent, Brut Réel ≠ somme, ligne sans aucun montant, nouvel employé sans matricule.

**G9. Rapport Excel annoté** : le fichier d'erreurs reprend le fichier importé, lignes et cellules en cause surlignées (rouge à corriger, orange à confirmer) avec le message en commentaire.
