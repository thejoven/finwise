.PHONY: dev down logs migrate migrate-down migrate-status run test fmt lint tidy ent-gen healthz \
	admin-dev admin-build admin-deploy \
	docker-build docker-up docker-down docker-logs docker-migrate docker-migrate-status docker-deploy

# Load .env if present (silent if missing).
-include .env
export

# --- Infrastructure ---

dev:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f

# --- Migrations ---
# Uses scripts/migrate.sh (docker compose exec psql) to dodge the
# golang-migrate LC_UUID issue on macOS 26.x. When that's resolved or you're
# on Linux, you can swap back to `migrate -database $$DATABASE_URL ...`.

migrate:
	./scripts/migrate.sh up

migrate-down:
	./scripts/migrate.sh down 1

migrate-status:
	./scripts/migrate.sh status

# --- Go ---

run:
	cd server && go run ./cmd/api

test:
	cd server && go test ./...

fmt:
	cd server && gofmt -w . && goimports -w .

lint:
	cd server && golangci-lint run

tidy:
	cd server && go mod tidy

ent-gen:
	cd server && go run -mod=mod entgo.io/ent/cmd/ent generate ./internal/infra/db/schema

# --- Smoke ---

healthz:
	curl -fsS localhost:$${PORT:-8080}/healthz && echo

# --- Web admin (web-admin/) ---
# Static React SPA built with Vite, served behind nginx on the dev box.
# Reachable at http://192.168.1.205:8082/ once deployed.

admin-dev:
	cd web-admin && npm run dev

admin-build:
	cd web-admin && npm run build

admin-deploy:
	cd web-admin && ./deploy/deploy.sh

# --- Docker (全栈) ---
# 用 profile=prod 把 api + mastra + web-admin 一起拉起来.
# 详见 README.md 的 "Docker 部署" 段.

docker-build:
	docker compose --profile prod build

docker-up:
	docker compose --profile prod up -d --build

docker-down:
	docker compose --profile prod down

docker-logs:
	docker compose --profile prod logs -f api mastra

docker-migrate:
	docker compose --profile migrate run --rm migrator up

docker-migrate-status:
	docker compose --profile migrate run --rm migrator status

docker-deploy:
	./scripts/docker-deploy.sh
