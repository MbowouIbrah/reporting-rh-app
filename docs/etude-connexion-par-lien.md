# Étude : connexion par lien (démo et invitation)

## Besoin
Pour la présentation N2 et les invitations, chaque compte reçoit un lien qui ouvre directement sa session. La personne n'a pas besoin de connaître l'adresse ni le mot de passe. Le mail d'invitation garde la présentation du mail précédent (`reporting-rh-test/mail-corps.html`).

## Contraintes
- Le lien ne doit jamais apparaître dans les journaux du serveur ni du proxy.
- On doit pouvoir le couper (le révoquer) sans toucher au mot de passe.
- Il expire de lui-même.
- La session ouverte est la même que celle d'une connexion normale : mêmes cookies, mêmes droits, filtre de périmètre côté serveur.

## Existant
- La réinitialisation du mot de passe utilise déjà un jeton placé dans le fragment `#jeton=` (`Reinitialiser.tsx`). Le fragment ne part jamais vers le serveur.
- `_set_cookies` et `_me` (`api/auth.py`) ouvrent la session. `audit.record` trace les connexions.
- Il n'existe aucune table de jetons : les jetons actuels sont des JWT sans état.

## Options
| Option | Pour | Contre |
|---|---|---|
| JWT signé, lié au mot de passe | Pas de table | Impossible de couper un seul lien ; changer le mot de passe coupe tout |
| **Table `lien_connexion`, seule l'empreinte sha256 est stockée** | Révocable un par un, expiration, compteur d'usages, aucun jeton lisible en base | Une migration |

**Choix : la table.** Le jeton fait 32 octets aléatoires (`secrets.token_urlsafe`), et seule son empreinte est enregistrée. Une copie de la base ne permet donc pas de se connecter.

## Fonctionnement
- URL : `/connexion-rapide#jeton=…`.
- La page lit le fragment, l'efface de la barre d'adresse, puis appelle `POST /auth/lien {jeton}`.
- Si le lien est valide (non expiré, non révoqué, compte actif), le serveur pose les cookies de session, sans « se souvenir de moi », trace `login_lien` et renvoie le profil. Sinon, il renvoie un 401 avec un message unique (« Lien invalide ou expiré »).
- Le lien reste réutilisable jusqu'à son expiration (14 jours par défaut), parce qu'un compte de démo sert à plusieurs personnes. On peut le révoquer à tout moment.
- Un compte au mot de passe provisoire suit la règle habituelle : la page de changement du mot de passe s'affiche.
- Création et révocation passent par un script en ligne de commande (`tools/recette/liens.py`). Le même script écrit le mail HTML à partir de l'adresse publique (`adresse.txt`).

## Impacts
- La migration 0024 ajoute une table, sans toucher aux données existantes.
- Sécurité : un lien transféré donne l'accès. C'est voulu pour la démo, et l'expiration courte plus la révocation limitent le risque. Le lien est porteur, comme un mot de passe envoyé par mail ; il ne remplace pas le mot de passe en production.
- Aucun impact sur les performances.

## Risques et décisions prises
- La version de test expose de vraies adresses CFAO (comptes réels demandés), mais les données restent fictives. Ce point est signalé à la livraison.
- Le tunnel change d'adresse à chaque relance : il faut régénérer les liens et le mail après chaque relance.
- Un bouton « envoyer un lien » dans la page Utilisateurs n'est pas fait dans ce cycle (backlog).
