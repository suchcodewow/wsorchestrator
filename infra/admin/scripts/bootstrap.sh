#!/usr/bin/env bash
# One-time bootstrap: enable the handful of APIs this config needs before it can
# read or create anything, then hand off to the Harness IaCM workspace that holds
# the state.
#
# There is no state bucket to create any more. This module's state used to live
# in a GCS bucket made here, ahead of the first apply, to solve the chicken-and-
# egg where the config that manages infra can't store its state in infra it
# hasn't created yet. The IaCM workspace solves the same problem by living
# outside GCP entirely, so the bucket step is gone and `init` no longer takes a
# -backend-config.
#
# Usage:
#   ADMIN_PROJECT=my-admin-project REGION=us-central1 ./scripts/bootstrap.sh
set -euo pipefail

: "${ADMIN_PROJECT:?set ADMIN_PROJECT}"
REGION="${REGION:-us-central1}"

# Use terraform if present, else OpenTofu (matches the Makefile).
TF_BIN="${TF_BIN:-$(command -v terraform >/dev/null 2>&1 && echo terraform || echo tofu)}"

echo ">> Enabling foundational APIs on ${ADMIN_PROJECT}"
gcloud services enable \
  cloudresourcemanager.googleapis.com \
  serviceusage.googleapis.com \
  storage.googleapis.com \
  --project "${ADMIN_PROJECT}"

cat <<'EOF'
>> APIs enabled.

State for this module belongs to the Harness IaCM workspace
`admin_control_plane` (org default, project default_project). The pipeline
initializes against it automatically; nothing to create here.

To run tofu by hand:
  export TF_HTTP_PASSWORD=<harness PAT with Workspace Access State>
  ./scripts/backend-local.sh
  tofu init && tofu plan -var-file=terraform.tfvars
EOF
