# Runbook : Reporting RH (production)

Serveur Academy, réseau Docker `edge`, base sans port publié. Commandes depuis la racine du dépôt.

## 1. Mise en service
1. `docker network create edge` (une fois), nginx d'Academy rattaché à `edge`.
2. `cp deploy/.env.example deploy/.env` puis renseigner `POSTGRES_PASSWORD`, `SECRET_KEY` (≥ 32 car.), `ADMIN_EMAIL`, `ADMIN_PASSWORD` (≥ 12 car.).
3. `docker compose -f deploy/docker-compose.yml up -d --build` : les migrations Alembic et le seed (référentiels, périmètres, rh_admin) tournent au démarrage, idempotents.
4. Inclure `deploy/nginx-academy-snippet.conf` dans le nginx d'Academy, recharger.
5. Vérifier : `docker compose -f deploy/docker-compose.yml ps` (api healthy) et connexion en rh_admin.
6. Retirer `ADMIN_PASSWORD` de `deploy/.env`, puis `docker compose -f deploy/docker-compose.yml up -d api`.

## 2. Comptes
- Premier compte : rh_admin créé par le seed (étape 1.3).
- Les autres comptes : page Admin > Utilisateurs (rôle `lecteur_global`, `lecteur_perimetre` + périmètre, droit nominatif). Modèle d'attribution : DRH et DOP en `lecteur_global`, DPS Equipment en `lecteur_perimetre` Equipment, directeur commercial en `lecteur_perimetre` Commerce VN.
- Mots de passe : 12 caractères minimum, communiqués hors e-mail ; chaque création/modification est tracée dans Admin > Journal.
- Départ d'un utilisateur : désactiver le compte (ne pas supprimer, pour garder l'audit).

## 3. Sauvegarde
- `deploy/scripts/sauvegarde.sh` : `pg_dump -Fc` dans `deploy/backups/` (variable `BACKUP_DIR`), rotation 30 jours (`RETENTION_JOURS`).
- Planification (cron serveur) : `0 2 * * * /chemin/reporting-rh-app/deploy/scripts/sauvegarde.sh`.
- Copier `deploy/backups/` hors du serveur (volume Docker `rh_pgdata` seul = pas une sauvegarde).
- `deploy/scripts/test-restauration.sh [FICHIER]` : restaure dans une base jetable `<base>_restore_test`, compare le nombre de lignes de chaque table avec la production, supprime la base jetable. Code retour 0 = sauvegarde exploitable. À lancer après la mise en service puis chaque mois.

## 4. Restauration
1. `docker compose -f deploy/docker-compose.yml stop api`
2. `CONFIRMER=oui deploy/scripts/restauration.sh deploy/backups/reporting_rh_AAAAMMJJ_HHMMSS.dump` (la base est supprimée puis recréée).
3. `docker compose -f deploy/docker-compose.yml up -d api` (le démarrage rejoue les migrations manquantes).
4. Vérifier un rapport mensuel connu.

## 5. Mise à jour et rollback
Avant toute mise à jour : `deploy/scripts/sauvegarde.sh`, puis noter le commit en cours (`git rev-parse --short HEAD`).
1. `git pull`, `docker compose -f deploy/docker-compose.yml up -d --build`.
2. Échec ou régression : `git checkout <commit noté>`, puis
   - sans migration dans la mise à jour : `up -d --build` suffit ;
   - avec migration : restaurer la sauvegarde d'avant (section 4) avant de relancer l'ancienne version. Ne pas faire de `alembic downgrade` sur des données réelles sans sauvegarde fraîche.
3. Consigner l'incident dans `PASSATION.md`.

## 6. Archivage de l'Excel
À faire à la fin du double run (P8), pas avant : copier `REPORTING_RH_V4/V5` (et `golden/`) dans un dossier d'archive daté, en lecture seule, avec empreinte :
`sha256sum *.xlsx > SHA256SUMS`. L'Excel cesse d'être mis à jour ; l'application devient la référence.

## 7. Exploitation courante
- Logs : `docker compose -f deploy/docker-compose.yml logs --tail 100 api`.
- Santé : `GET /health` sur l'API (healthcheck Docker).
- Verrou période : clôturer une période dans Admin avant diffusion ; une période verrouillée n'accepte plus d'import.
- Droits : toute lecture nominative et tout export sont audités (Admin > Journal).
