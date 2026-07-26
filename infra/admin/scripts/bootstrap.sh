#!/usr/bin/env bash
# One-time bootstrap: create the GCS bucket that holds THIS Terraform's own
# state, then init the backend against it. Solves the chicken-and-egg where
# the config that manages infra can't store its state in infra it hasn't
# created yet.
#
# Usage:
#   ADMIN_PROJECT=my-admin-project REGION=us-central1 \
#   STATE_BUCKET=my-admin-project-infra-tfstate ./scripts/bootstrap.sh
set -euo pipefail

: "${ADMIN_PROJECT:?set ADMIN_PROJECT}"
: "${STATE_BUCKET:?set STATE_BUCKET}"
REGION="${REGION:-us-central1}"

# Use terraform if present, else OpenTofu (matches the Makefile).
TF_BIN="${TF_BIN:-$(command -v terraform >/dev/null 2>&1 && echo terraform || echo tofu)}"

echo ">> Enabling foundational APIs on ${ADMIN_PROJECT}"
gcloud services enable \
  cloudresourcemanager.googleapis.com \
  serviceusage.googleapis.com \
  storage.googleapis.com \
  --project "${ADMIN_PROJECT}"

if gcloud storage buckets describe "gs://${STATE_BUCKET}" --project "${ADMIN_PROJECT}" >/dev/null 2>&1; then
  echo ">> Bucket gs://${STATE_BUCKET} already exists"
else
  echo ">> Creating state bucket gs://${STATE_BUCKET}"
  gcloud storage buckets create "gs://${STATE_BUCKET}" \
    --project "${ADMIN_PROJECT}" \
    --location "${REGION}" \
    --uniform-bucket-level-access
  gcloud storage buckets update "gs://${STATE_BUCKET}" --versioning
fi

echo ">> ${TF_BIN} init"
"${TF_BIN}" init \
  -backend-config="bucket=${STATE_BUCKET}" \
  -backend-config="prefix=admin"

echo ">> Done. Next: ${TF_BIN} plan -var-file=terraform.tfvars"
