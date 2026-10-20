# Backlog

Règle : toute demande hors périmètre du cycle en cours est consignée ici et traitée au cycle suivant.

| ID | Date | Demandeur | Description | Cycle cible | Statut |
|---|---|---|---|---|---|
| B-001 | 2026-10-02 | Cadrage | SSO Keycloak + Cerbos, MFA pour l'administrateur | 2 | Partiel : blocs exposés par /annuel et affichés (commit 05d) ; reste export xlsx annuel aligné, rotation Excel, effectifs annuels (moyennes mensuelles, note Excel) à valider avec l'utilisateur |
| B-002 | 2026-10-02 | Cadrage | Plusieurs administrateurs, délégation de saisie par périmètre, circuit de validation | 2 | À faire |
| B-003 | 2026-10-02 | Cadrage | Import direct depuis le SIRH / la paie | 2 | À faire |
| B-004 | 2026-10-02 | Cadrage | Export PDF du résumé et envoi mensuel par e-mail | 2 | À faire |
| B-005 | 2026-10-02 | Cadrage | Budgets pluriannuels et prévisions | 2 | À faire |
| B-006 | 2026-10-02 | Cadrage | Alertes de variation anormale par salarié (M vs M-1) | 2 | À faire |
| B-007 | 2026-10-02 | Cadrage | Multi-filiale | 2 | À faire |
| B-008 | 2026-10-02 | Cadrage | Tableau de bord des journaux d'audit | 2 | À faire |
| B-009 | 2026-10-02 | Cadrage | CA par périmètre (marge visible par les lecteurs à périmètre) | 2 | À faire |
| B-010 | 2026-10-02 | Cadrage | Mobile / hors ligne | 3 | À faire |
| B-011 | 2026-10-02 | P5 | Onglet ANNUEL de l'Excel non exposé par /annuel (blocs A rubrique, B activité, C sites et budgets annuels, D contrat, effectifs) ; rotation Excel différente de la formule P0 | 2 | À faire |
| B-012 | 2026-10-02 | P5 | Golden par période pour annuel et résumé (tools/golden_lo.py ne fixe que MENSUEL) | 3 | À faire |
| B-013 | 2026-10-08 | 07e | mypy en CI : 60 erreurs de typage à résorber (dictionnaires typés `Base` dans budgets/salaries, Optional non gardés dans imports/service et moteur, stubs openpyxl), puis ajouter `mypy app` au job backend | 3 | À faire |
| B-014 | 2026-10-08 | 08a | Feuille DONNEES (/donnees/tableau) sans pagination : ~1 400 lignes aujourd'hui ; au-delà de ~5 000, ajouter limit/offset ou virtualiser le tableau | 3 | À faire |
| B-015 | 2026-10-09 | 08c | Budget MS de la synthèse : reste budget_employe × effectif ; le relier au total des budgets par site saisis si l'admin le souhaite | 3 | À faire |
| B-016 | 2026-10-19 | 11 | Historique des enregistrements : liste des imports et saisies passés, annulation d'un enregistrement précis (pas seulement le dernier), voire suivi des modifications ligne par ligne façon versions | 2 | À faire |
| B-017 | 2026-10-19 | 11 | Contrôles d'import manquants (test août) : ANNÉE/MOIS différent du mois choisi, montant ×10 ou saisi en milliers vs M-1, Brut Réel ≠ somme des composantes, « 45.000 » lu 45 sans alerte claire, formule sans valeur calculée perdue, ligne sans aucun montant | 2 | Fait (G5, G4, G12) |
