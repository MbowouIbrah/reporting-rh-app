.PHONY: help up down logs ps migrate shell backup test test-pg test-back test-front test-e2e test-audit test-clean

TEST = docker compose -f docker-compose.test.yml run --rm --build tests

help:
	@echo "up          Construire et démarrer l'application"
	@echo "down        Arrêter l'application (les données restent)"
	@echo "logs / ps   Journaux / état des conteneurs"
	@echo "migrate     Appliquer les migrations"
	@echo "shell       Console Python dans l'API"
	@echo "backup      Sauvegarder la base"
	@echo "test        Tous les tests en conteneur (test-pg, -back, -front, -e2e, -audit)"
	@echo "test-clean  Retirer les conteneurs et l'image de test"

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f --tail 100

ps:
	docker compose ps

migrate:
	docker compose exec api alembic upgrade head

shell:
	docker compose exec api python

backup:
	sh scripts/sauvegarde.sh

test:
	$(TEST) tout

test-pg:
	$(TEST) pg

test-back:
	$(TEST) back

test-front:
	$(TEST) front

test-e2e:
	$(TEST) e2e

test-audit:
	$(TEST) audit

test-clean:
	docker compose -f docker-compose.test.yml down -v --rmi local
