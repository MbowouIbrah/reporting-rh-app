# Backlog

Règle : toute demande hors périmètre du cycle en cours est consignée ici et traitée au cycle suivant.

| ID | Date | Demandeur | Description | Cycle cible | Statut |
|---|---|---|---|---|---|
| B-001 | 2026-10-02 | Cadrage | SSO Keycloak + Cerbos, MFA pour l'administrateur | 2 | À faire |
| B-002 | 2026-10-02 | Cadrage | Plusieurs administrateurs, délégation de saisie par périmètre, circuit de validation | 2 | À faire |
| B-003 | 2026-10-02 | Cadrage | Import direct depuis le SIRH / la paie | 2 | À faire |
| B-004 | 2026-10-02 | Cadrage | Export PDF du résumé et envoi mensuel par e-mail | 2 | À faire |
| B-005 | 2026-10-02 | Cadrage | Budgets pluriannuels et prévisions | 2 | À faire |
| B-006 | 2026-10-02 | Cadrage | Alertes de variation anormale par salarié (M vs M-1) | 2 | À faire |
| B-007 | 2026-10-02 | Cadrage | Multi-filiale | 2 | À faire |
| B-008 | 2026-10-02 | Cadrage | Tableau de bord des journaux d'audit | 2 | À faire |
| B-009 | 2026-10-02 | Cadrage | CA par périmètre (marge visible par les lecteurs à périmètre) | 2 | À faire |
| B-010 | 2026-10-02 | Cadrage | Mobile / hors ligne | 3 | À faire |

- Onglet ANNUEL de l'Excel non exposé par `/annuel` : bloc A par rubrique, B par activité, C sites avec budgets annuels, D contrat, analyse des effectifs. Rotation Excel = (recrutements + départs) / 2 / fin, différente de la formule P0.
- Golden par période pour annuel et résumé : `tools/golden_lo.py` ne fixe que MENSUEL (le sélecteur des onglets annuel/résumé est figé sur 2026 / juin).
