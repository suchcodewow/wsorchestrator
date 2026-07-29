# Workshop Orchestrator — deploy orchestration.
# Config is derived from Terraform outputs so there's a single source of truth.
#
# Prereqs: gcloud (authenticated), terraform/tofu, cloud-sql-proxy.
# One-time: fill infra/admin/terraform.tfvars, then `make bootstrap infra`.
# Thereafter: `make ship` builds, deploys, and migrates.

.DEFAULT_GOAL := help

# Use terraform if present, else OpenTofu.
TF_BIN ?= $(shell command -v terraform >/dev/null 2>&1 && echo terraform || echo tofu)
TF      = $(TF_BIN) -chdir=infra/admin

# Derived from Terraform outputs (empty until `make infra` has run).
PROJECT = $(shell $(TF) output -raw admin_project_id 2>/dev/null)
REGION  = $(shell $(TF) output -raw region 2>/dev/null)
REPO    = $(shell $(TF) output -raw artifact_registry 2>/dev/null)
DB_CONN = $(shell $(TF) output -raw db_connection_name 2>/dev/null)
# DB_CONN is project:region:instance; backups need the bare instance name.
DB_INSTANCE = $(lastword $(subst :, ,$(DB_CONN)))
APP_URL = $(shell $(TF) output -raw app_url 2>/dev/null)

# Image tag = current commit (fallback: latest).
TAG ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo latest)

# State bucket for the admin config itself (bootstrap only).
STATE_BUCKET ?= $(ADMIN_PROJECT)-infra-tfstate

# The Next.js app, including the Drizzle schema and its SQL migrations.
FRONTEND ?= frontend

.PHONY: help bootstrap plan infra images deploy db-backup db-migrate db-push ship info

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Typical first run:  make bootstrap infra images deploy db-push"
	@echo "Typical redeploy:   make ship"

bootstrap: ## One-time: create admin state bucket + init backend (needs ADMIN_PROJECT, STATE_BUCKET)
	cd infra/admin && ADMIN_PROJECT=$(ADMIN_PROJECT) REGION=$(REGION) \
	  STATE_BUCKET=$(STATE_BUCKET) TF_BIN=$(TF_BIN) ./scripts/bootstrap.sh

plan: ## Terraform plan for the admin control plane
	$(TF) plan -var-file=terraform.tfvars

infra: ## Apply admin control plane (uses placeholder images on first run)
	$(TF) apply -var-file=terraform.tfvars

images: ## Build + push app and runner images via Cloud Build
	@test -n "$(REPO)" || { echo "No REPO — run 'make infra' first"; exit 1; }
	gcloud builds submit --project $(PROJECT) --config cloudbuild.yaml \
	  --service-account=projects/$(PROJECT)/serviceAccounts/build-sa@$(PROJECT).iam.gserviceaccount.com \
	  --substitutions=_REPO=$(REPO),_TAG=$(TAG) .

deploy: ## Point Cloud Run at the freshly built images and apply
	@test -n "$(REPO)" || { echo "No REPO — run 'make infra' first"; exit 1; }
	$(TF) apply -var-file=terraform.tfvars \
	  -var app_image=$(REPO)/app:$(TAG) \
	  -var runner_image=$(REPO)/runner:$(TAG)

db-backup: ## On-demand Cloud SQL backup — take one before any schema change
	@test -n "$(DB_INSTANCE)" || { echo "No DB_INSTANCE — run 'make infra' first"; exit 1; }
	gcloud sql backups create --instance=$(DB_INSTANCE) --project=$(PROJECT)

db-migrate: ## Apply hand-written SQL migrations in frontend/drizzle (data backfills)
	DB_CONN=$(DB_CONN) PROJECT=$(PROJECT) ./scripts/with-db.sh \
	  "node $(FRONTEND)/scripts/apply-sql.mjs"

db-push: ## Apply the Drizzle schema to Cloud SQL (via proxy)
	DB_CONN=$(DB_CONN) PROJECT=$(PROJECT) ./scripts/with-db.sh \
	  "npm --prefix $(FRONTEND) run db:push"

# db-migrate runs first: it backfills and reshapes data that db-push would
# otherwise destroy (push diffs schema only and cannot preserve data).
ship: images deploy db-migrate db-push ## Build, deploy, and migrate in one shot
	@echo ""
	@echo "Shipped $(TAG) → $(APP_URL)"

info: ## Print the resolved deploy config
	@echo "TF_BIN   = $(TF_BIN)"
	@echo "PROJECT  = $(PROJECT)"
	@echo "REGION   = $(REGION)"
	@echo "REPO     = $(REPO)"
	@echo "DB_CONN  = $(DB_CONN)"
	@echo "TAG      = $(TAG)"
	@echo "APP_URL  = $(APP_URL)"
