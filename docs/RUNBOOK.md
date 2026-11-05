# Runbook : Reporting RH (production)

Projet autonome (API, page web, base) ; seule la page web publie un port, la base aucun. Commandes depuis la racine du dépôt.

## 1. Mise en service
1. `cp .env.example .env` puis renseigner `POSTGRES_PASSWORD`, `SECRET_KEY` (≥ 32 car.), `ADMIN_EMAIL`, `ADMIN_PASSWORD` (≥ 8 car.). Ce mot de passe est provisoire : l'application impose d'en choisir un autre à la première connexion.
2. `docker compose up -d --build` : les migrations Alembic et le seed (listes de valeurs, périmètres, compte administrateur si aucun compte actif ne gère les comptes) tournent au démarrage, idempotents.
3. Mettre un proxy HTTPS devant `127.0.0.1:8080` (`WEB_PORT`) en transmettant `X-Forwarded-Proto` et `X-Forwarded-For`. Un seul proxy devant l'application : il ajoute l'adresse réelle du client en dernier (nginx : `$proxy_add_x_forwarded_for`). Le port web reste lié à 127.0.0.1 (`WEB_BIND`) : seul le proxy doit l'atteindre. Renseigner `APP_URL` avec l'adresse publique. Sans HTTPS, le cookie de session n'est pas accepté hors localhost.
4. Vérifier : `docker compose ps` (api healthy) et connexion avec le compte administrateur, puis choix d'un nouveau mot de passe (imposé).
5. Retirer `ADMIN_PASSWORD` de `.env`, puis `docker compose up -d api`.

## 2. Comptes
Écran Administration > Utilisateurs, ou console serveur : `C="docker compose exec api python -m app.comptes"`.
- Premier compte : administrateur créé au démarrage (étape 1.2).
- Les autres comptes (mot de passe demandé au clavier, jamais en argument) :
  - `$C perimetres` : codes disponibles (`dps`, `commerce_vn`, `pneumatique`, `sav_pl`, `sav_engins`, `sites_deportes`) ;
  - `$C creer drh@exemple.invalid --nom "DRH" --modele global` ;
  - `$C creer dps@exemple.invalid --nom "DPS" --modele perimetre --perimetre dps`.
- Modèle d'attribution : les deux administrateurs RH en `admin` ; DRH et DOP en `global` ; en `perimetre` : DPS `dps`, directeur commercial `commerce_vn`, DC Pneumatique `pneumatique`, directeur technique `sav_pl`, responsable technique SAV Engins `sav_engins`, responsable des sites déportés `sites_deportes`. `--nominatif` ouvre le reporting individuel à un compte `perimetre` (`global` l'a d'office).
- `$C lister`, `$C droits EMAIL --modele ...`, `$C mot-de-passe EMAIL`, `$C exiger-changement EMAIL`, `$C desactiver EMAIL` / `$C activer EMAIL`.
- Mots de passe : 8 caractères minimum, 72 octets maximum, pas seulement des espaces, communiqués hors e-mail. Tout mot de passe posé par un administrateur est provisoire : l'utilisateur doit le changer avant de continuer. Un administrateur change le sien par le lien de sa fiche. Il reste toujours au moins un compte actif qui gère les comptes (refus sinon). Si aucun compte actif ne gère les comptes et que `ADMIN_EMAIL` désigne un compte existant, le démarrage le signale sans rien créer : `$C activer EMAIL` ou `$C droits EMAIL --modele admin`.
- Départ d'un utilisateur : `desactiver` (ne pas supprimer, pour garder l'audit).
- Sans SMTP (`SMTP_HOST` vide), aucun e-mail ne part : l'administrateur pose un mot de passe provisoire dans Administration > Utilisateurs, à changer avant de continuer.
- Mot de passe oublié (page de connexion) : lien à usage unique valable 30 min, envoyé par e-mail, une demande toutes les 5 min par compte. Variables de `.env` : `APP_URL` (adresse publique), `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_TLS` (true = STARTTLS). Sans `SMTP_HOST`, rien n'est envoyé en production (journal : `reinit_non_envoye`) : poser alors un mot de passe provisoire depuis la page Utilisateurs ou `$C mot-de-passe`.
- Connexion, changement de mot de passe, mot de passe oublié et réinitialisation : 10 essais par minute et par adresse, rafale de 10 (`frontend/nginx.conf`). Pour les appels venant d'une adresse privée, nginx retient la dernière adresse de `X-Forwarded-For`, celle ajoutée par le proxy : ce qu'un poste y met lui-même est ignoré. Ne pas publier le port web directement (`WEB_BIND=0.0.0.0`) : un poste de l'intranet pourrait alors écrire cet en-tête et contourner la limite.
- Journal : `$C journal [--entite utilisateur] [--limite 50] [--detail]` ; « console » = action faite par cet outil.

## 3. Sauvegarde
- `scripts/sauvegarde.sh` : `pg_dump -Fc` dans `BACKUP_DIR`, rotation 30 jours (`RETENTION_JOURS`). En production, `BACKUP_DIR` pointe vers un disque monté hors du serveur : une copie restée sur le serveur disparaît avec lui.
- Planification (cron serveur) : `0 2 * * * /chemin/reporting-rh-app/scripts/sauvegarde.sh`.
- Copier `backups/` hors du serveur (volume Docker `rh_pgdata` seul = pas une sauvegarde).
- `scripts/test-restauration.sh [FICHIER]` : restaure dans une base jetable `<base>_restore_test`, compare le nombre de lignes de chaque table avec la production, supprime la base jetable. Code retour 0 = sauvegarde exploitable. À lancer après la mise en service puis chaque mois.

## 4. Restauration
1. `docker compose stop api`
2. `CONFIRMER=oui scripts/restauration.sh backups/reporting_rh_AAAAMMJJ_HHMMSS.dump` (la base est supprimée puis recréée).
3. `docker compose up -d api` (le démarrage rejoue les migrations manquantes).
4. Vérifier un rapport mensuel connu.

## 5. Mise à jour et rollback
Avant toute mise à jour : `scripts/sauvegarde.sh`, puis noter le commit en cours (`git rev-parse --short HEAD`).
1. `git pull`, `docker compose up -d --build`.
   Mise à niveau d'une base existante vers la migration 0022 : les comptes déjà créés ne sont pas concernés par le changement obligatoire. Pour l'imposer à un compte : `$C exiger-changement EMAIL`. Descendre puis remonter 0022 efface ces drapeaux.
2. Échec ou régression : `git checkout <commit noté>`, puis
   - sans migration dans la mise à jour : `up -d --build` suffit ;
   - avec migration : restaurer la sauvegarde d'avant (section 4) avant de relancer l'ancienne version. Ne pas faire de `alembic downgrade` sur des données réelles sans sauvegarde fraîche.
3. Consigner l'incident dans `PASSATION.md`.

## 6. Archivage de l'Excel
À faire à la fin du double run (P8), pas avant : copier `REPORTING_RH_V4/V5` (et `golden/`) dans un dossier d'archive daté, en lecture seule, avec empreinte :
`sha256sum *.xlsx > SHA256SUMS`. L'Excel cesse d'être mis à jour ; l'application devient la référence.

## 7. Exploitation courante
- Logs : `docker compose logs --tail 100 api`.
- Santé : `GET /health` sur l'API (healthcheck Docker).
- Saisie du mois : page Administration > « Renseigner des données » (lignes de paie, import Excel, CA et marge, budgets). Un mois s'ouvre au premier enregistrement.
- Pas de verrou de période : un mois reste modifiable. Avant diffusion, exporter le rapport ; toute modification ultérieure figure au journal (`$C journal --detail`).
- Droits : toute lecture nominative et tout export sont audités (même journal).
