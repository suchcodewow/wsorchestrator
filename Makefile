# Workshop Orchestrator — deploy orchestration.
# Config is derived from Terraform outputs so there's a single source of truth.
#
# Prereqs: gcloud (authenticated), terraform/tofu, cloud-sql-proxy.
# One-time: fill infra/admin/terraform.tfvars, then `make bootstrap infra`.
# Thereafter: `make ship` builds, deploys, migrates, and seeds.

.DEFAULT_GOAL := help

# Use terraform if present, else OpenTofu.
TF_BIN ?= $(shell command -v terraform >/dev/null 2>&1 && echo terraform || echo tofu)
TF      = $(TF_BIN) -chdir=infra/admin

# Derived from Terraform outputs (empty until `make infra` has run).
PROJECT = $(shell $(TF) output -raw admin_project_id 2>/dev/null)
REGION  = $(shell $(TF) output -raw region 2>/dev/null)
REPO    = $(shell $(TF) output -raw artifact_registry 2>/dev/null)
DB_CONN = $(shell $(TF) output -raw db_connection_name 2>/dev/null)
APP_URL = $(shell $(TF) output -raw app_url 2>/dev/null)

# Image tag = current commit (fallback: latest).
TAG ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo latest)

# State bucket for the admin config itself (bootstrap only).
STATE_BUCKET ?= $(ADMIN_PROJECT)-infra-tfstate

.PHONY: help bootstrap plan infra images deploy db-push seed ship info

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Typical first run:  make bootstrap infra images deploy db-push seed"
	@echo "Typical redeploy:   make ship"

bootstrap: ## One-time: create admin state bucket + init backend (needs ADMIN_PROJECT, STATE_BUCKET)
	cd infra/admin && ADMIN_PROJECT=$(ADMIN_PROJECT) REGION=$(REGION) \
	  STATE_BUCKET=$(STATE_BUCKET) ./scripts/bootstrap.sh

plan: ## Terraform plan for the admin control plane
	$(TF) plan -var-file=terraform.tfvars

infra: ## Apply admin control plane (uses placeholder images on first run)
	$(TF) apply -var-file=terraform.tfvars

images: ## Build + push app and runner images via Cloud Build
	@test -n "$(REPO)" || { echo "No REPO — run 'make infra' first"; exit 1; }
	gcloud builds submit --project $(PROJECT) --config cloudbuild.yaml \
	  --substitutions=_REPO=$(REPO),_TAG=$(TAG) .

deploy: ## Point Cloud Run at the freshly built images and apply
	@test -n "$(REPO)" || { echo "No REPO — run 'make infra' first"; exit 1; }
	$(TF) apply -var-file=terraform.tfvars \
	  -var app_image=$(REPO)/app:$(TAG) \
	  -var runner_image=$(REPO)/runner:$(TAG)

db-push: ## Apply the Drizzle schema to Cloud SQL (via proxy)
	DB_CONN=$(DB_CONN) PROJECT=$(PROJECT) ./scripts/with-db.sh "npm run db:push"

seed: ## Load sample workshops into Cloud SQL (via proxy)
	DB_CONN=$(DB_CONN) PROJECT=$(PROJECT) ./scripts/with-db.sh "npm run db:seed"

ship: images deploy db-push seed ## Build, deploy, migrate, and seed in one shot
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
