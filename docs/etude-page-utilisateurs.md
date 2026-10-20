# Étude : page de gestion des utilisateurs

Date : 2026-10-20. Branche `page-utilisateurs`.

## Besoin
Un administrateur RH doit pouvoir gérer les comptes de l'application (pas les employés) depuis l'interface : voir la liste, créer un compte, changer son rôle, son périmètre ou son mot de passe, le désactiver ou le supprimer. Aujourd'hui, seuls la console serveur (`python -m app.comptes`) et l'API directe le permettent.

## Existant
- API complète (`backend/app/api/admin.py`) : `GET/POST /users`, `PUT/DELETE /users/{id}`, droit `users:read` / `users:write` (rh_admin seul). Contrôles serveur : e-mail valide, mot de passe de 12 caractères minimum, `lecteur_perimetre` ⇔ périmètre, au moins un administrateur actif, pas d'auto-suppression, doublon d'e-mail → 409. Chaque écriture est auditée.
- `GET /perimetres` donne les libellés des périmètres.
- Front : onglets d'administration (`AdminNav`), pages `Employes.tsx` et `Referentiels.tsx` (formulaire `Champ`, tableau `dense`, `Panneau`, `Etat`, `Confirmer`), client `api/admin.ts` (`useEcriture` rafraîchit le cache après écriture), utilitaire de test `testSupport.tsx`.
- Rôles (P0_CADRAGE §2) : un compte = une affectation de rôle.

## Options
| Option | Pour | Contre |
|---|---|---|
| A. Page dédiée « Utilisateurs », calquée sur Employés (liste + formulaire repliable) | Cohérente avec l'existant, composants réutilisés, aucun changement serveur | — |
| B. Bloc dans la page Référentiels | Pas de nouvel onglet | Mélange deux sujets, page déjà chargée |
| C. Gestion multi-rôles complète (plusieurs affectations par compte) | Couvre tous les cas de l'API | Complexe ; aucun besoin au cadrage (1 compte = 1 rôle) |

## Choix : A
- Onglet « Utilisateurs » (`/admin/utilisateurs`), visible et accessible avec `users:write`.
- Tableau : nom, adresse, rôle, périmètre, détail nominatif, statut, actions (Modifier, Désactiver/Réactiver, Supprimer avec confirmation). Recherche par nom ou adresse.
- Formulaire : nom, adresse (non modifiable après création : l'API ne le permet pas), mot de passe (obligatoire à la création, facultatif en modification), rôle, périmètre (seulement pour un lecteur à périmètre), case « accès au détail nominatif » (seulement pour un lecteur à périmètre ; les rôles globaux l'ont d'office).
- Un seul rôle par compte dans le formulaire. Si un compte en a plusieurs (cas créé hors interface), tous sont affichés et un avertissement prévient qu'enregistrer les remplace.
- Son propre compte : ni désactivation ni suppression proposées (évite de se fermer l'accès).
- Contrôles côté front identiques à ceux du serveur, pour des messages immédiats ; le serveur reste l'autorité.

## Impacts
- Données / migrations : aucun. Serveur : aucun changement.
- Sécurité : droits contrôlés par le serveur ; l'onglet et la route sont masqués sans `users:write`. Mot de passe jamais réaffiché.
- Déploiement : front seul.

## Risques
- Comptes de recette créés avec des mots de passe courts (hors règle des 12 caractères) : sans effet, on ne modifie le mot de passe que si un nouveau est saisi.

## Points à trancher
Aucun bloquant.
