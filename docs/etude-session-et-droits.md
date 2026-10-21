# Étude : session, droits visibles et filtres (21/10/2026)

## 1. Besoin
1. Après déconnexion puis connexion avec un autre compte, l'interface garde le profil (menus, fonction) du compte précédent jusqu'au rafraîchissement.
2. Une page sans droit ne doit pas exister pour l'utilisateur : pas de 403, pas d'onglet.
3. Tableaux et filtres limités au périmètre ; filtres en cascade, sans option qui mène à un résultat vide.
4. Résumé : cartes KPI équilibrées (5 cartes = 3 + 2 avec un trou).
5. Menu profil : fonction sur une ligne, « … » si trop longue.
6. Droits d'un compte : les sites apparaissent tous décochés.
7. Administration > Utilisateurs : bouton de copie de l'adresse e-mail.

## 2. Existant et causes
| Point | Constat |
|---|---|
| 1 | Le cookie de session est commun aux onglets, le profil `['me']` est propre à chaque onglet (`staleTime: Infinity`, copie en sessionStorage). Les captures montrent deux onglets ouverts : l'onglet resté ouvert garde l'ancien profil et reçoit les données du nouveau compte. |
| 2 | `RequireAuth` affiche `<Etat type="403">` ; l'onglet Administration n'apparaît qu'avec `saisie:write` alors que Sites et services ou Utilisateurs peuvent être accordés seuls. |
| 3 | Tableaux et options de `/rapports/filtres` sont déjà filtrés par `scope_for` côté serveur. Seule cascade : Type de site → Site. |
| 6 | Règle serveur : une dimension vide alors que l'autre est restreinte = aucune restriction sur elle (« service X sur tous les sites »). La fiche l'affichait « 0 sur N » : affichage faux, pas un défaut de droits. |

## 3. Choix
| Point | Option retenue | Écartée |
|---|---|---|
| 1 | `BroadcastChannel` : connexion et déconnexion préviennent les autres onglets, qui vident leur cache et rechargent le profil ; de plus `/auth/me` est revérifié quand l'onglet redevient visible (repli si le canal manque). | Recharger la page entière (perd l'état, plus lent). |
| 2 | Route interdite → redirection vers la première page autorisée ; onglet Administration visible avec n'importe quel droit d'administration et pointant vers le premier sous-onglet permis. | Garder le 403 (révèle la page). |
| 3 | `/rapports/filtres` renvoie aussi `combinaisons` (n-uplets distincts service, site, type, activité, contrat, poste du périmètre) ; chaque liste est calculée sur les combinaisons compatibles avec les autres filtres choisis. | Une requête par changement de filtre (latence). |
| 4 | Grille qui répartit les cartes en rangées égales (5 → 3 + 2 pleine largeur, via colonnes calculées sur le nombre de cartes). | |
| 5 | `nowrap` + ellipse + `title` (texte complet au survol). | |
| 6 | Dimension sans valeur alors que l'autre est restreinte : toutes ses cases affichées cochées (« Tout ») ; décocher un site restreint alors aux autres. Aucun changement serveur. | Enregistrer tous les sites explicitement (perd les futurs sites, et « tout coché » vaut « toutes les données »). |
| 7 | Petit bouton icône (Copier → Coché 2 s) dans la liste et la fiche, `navigator.clipboard`. | |

## 4. Impacts et risques
- Pas de migration. Sécurité inchangée : le serveur contrôle toujours chaque requête ; les changements côté front sont d'affichage.
- `combinaisons` : quelques centaines de n-uplets par an au plus, négligeable.
- Compte neuf sans aucune donnée cochée : reste « ne voit rien » (pas de « tout » implicite, qui ouvrirait toute l'entreprise par oubli).
