#!/usr/bin/env bash
# One-time: mint a long-lived credential for local Terraform / gcloud runs.
#
# Why this exists: `gcloud auth login` and `gcloud auth application-default
# login` produce USER credentials, which Workspace's Google Cloud session
# control reauth-challenges (16h by default) — hence the daily
# "Reauthentication failed" on tofu, the Cloud SQL proxy, and gcloud alike.
# A service account key is not a user credential, so no session policy applies
# to it and the login stops expiring.
#
# What it creates:
#   - tf-admin-sa in the admin project, holding exactly the roles the
#     Prerequisites section of ../README.md says an operator needs;
#   - a JSON key OUTSIDE the repo (default ~/.config/gcloud/), used as ADC;
#   - a gcloud configuration named `workshop-orchestrator` with that SA active,
#     so your `default` configuration (and whatever unrelated account it holds)
#     is left alone.
#
# The key is a standing secret with owner on the admin project plus folder and
# billing admin. Treat it like the AWS keys in terraform.tfvars: never commit
# it, and rotate with --force when you want a fresh one.
#
# Run from an interactive shell with a fresh `gcloud auth login`:
#   ./scripts/tf-admin-sa.sh
#
# Values default to terraform.tfvars; override with ADMIN_PROJECT,
# WORKSHOPS_FOLDER_ID, BILLING_ACCOUNT_ID, SA_ID, KEY_FILE, CONFIG_NAME.
set -euo pipefail

SA_ID="${SA_ID:-tf-admin-sa}"
CONFIG_NAME="${CONFIG_NAME:-workshop-orchestrator}"
KEY_FILE="${KEY_FILE:-$HOME/.config/gcloud/workshop-tf-admin.json}"
FORCE=""
[ "${1:-}" = "--force" ] && FORCE=1

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TFVARS="${TFVARS:-$HERE/../terraform.tfvars}"

# Pull a quoted scalar out of terraform.tfvars, so the one source of truth for
# these ids stays the tfvars file rather than a second copy in your shell.
tfvar() {
  [ -f "$TFVARS" ] || return 0
  sed -nE "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*\"([^\"]*)\".*/\1/p" "$TFVARS" | head -1
}

ADMIN_PROJECT="${ADMIN_PROJECT:-$(tfvar admin_project_id)}"
WORKSHOPS_FOLDER_ID="${WORKSHOPS_FOLDER_ID:-$(tfvar workshops_folder_id)}"
BILLING_ACCOUNT_ID="${BILLING_ACCOUNT_ID:-$(tfvar billing_account_id)}"

: "${ADMIN_PROJECT:?set ADMIN_PROJECT (or admin_project_id in terraform.tfvars)}"
: "${WORKSHOPS_FOLDER_ID:?set WORKSHOPS_FOLDER_ID (or workshops_folder_id in terraform.tfvars)}"
: "${BILLING_ACCOUNT_ID:?set BILLING_ACCOUNT_ID (or billing_account_id in terraform.tfvars)}"

SA_EMAIL="${SA_ID}@${ADMIN_PROJECT}.iam.gserviceaccount.com"
MEMBER="serviceAccount:${SA_EMAIL}"

echo ">> Admin project  : ${ADMIN_PROJECT}"
echo ">> Service account: ${SA_EMAIL}"
echo ""

# ------------------------------------------------------------------ #
# 1. The service account
# ------------------------------------------------------------------ #
if gcloud iam service-accounts describe "${SA_EMAIL}" --project "${ADMIN_PROJECT}" >/dev/null 2>&1; then
  echo ">> Service account already exists"
else
  echo ">> Creating ${SA_ID}"
  gcloud iam service-accounts create "${SA_ID}" \
    --project "${ADMIN_PROJECT}" \
    --display-name "Local Terraform operator (workshop-orchestrator)"
fi

# ------------------------------------------------------------------ #
# 2. Roles — mirrors what a human operator needs to run `make infra`
# ------------------------------------------------------------------ #
# Owner on the admin project: this Terraform manages Cloud SQL, Cloud Run,
# Secret Manager, Artifact Registry, GCS, Scheduler and project IAM there.
echo ">> Granting roles/owner on ${ADMIN_PROJECT}"
gcloud projects add-iam-policy-binding "${ADMIN_PROJECT}" \
  --member "${MEMBER}" --role roles/owner --condition=None >/dev/null

# On the workshops folder: folderAdmin to write runner-sa's and app-sa's folder
# bindings (iam.tf), plus project create/delete for the sandbox project
# (sandbox.tf). serviceUsageAdmin because Terraform also enables the sandbox
# project's APIs (google_project_service.sandbox_apis) — folderAdmin does not
# carry serviceusage.services.list, so without this a plan 403s on refresh.
# Scoped to the folder, not the org, matching runner-sa's own containment.
for role in \
  roles/resourcemanager.folderAdmin \
  roles/resourcemanager.projectCreator \
  roles/resourcemanager.projectDeleter \
  roles/serviceusage.serviceUsageAdmin
do
  echo ">> Granting ${role} on folders/${WORKSHOPS_FOLDER_ID}"
  gcloud resource-manager folders add-iam-policy-binding "${WORKSHOPS_FOLDER_ID}" \
    --member "${MEMBER}" --role "${role}" --condition=None >/dev/null
done

# billing.admin, not billing.user: Terraform GRANTS billing roles to runner-sa
# and app-sa (iam.tf), and granting on a billing account requires admin.
echo ">> Granting roles/billing.admin on ${BILLING_ACCOUNT_ID}"
gcloud billing accounts add-iam-policy-binding "${BILLING_ACCOUNT_ID}" \
  --member "${MEMBER}" --role roles/billing.admin >/dev/null

# ------------------------------------------------------------------ #
# 3. The key
# ------------------------------------------------------------------ #
mkdir -p "$(dirname "${KEY_FILE}")"
if [ -s "${KEY_FILE}" ] && [ -z "${FORCE}" ]; then
  echo ">> Key already present at ${KEY_FILE} (pass --force to mint a new one)"
else
  echo ">> Creating key at ${KEY_FILE}"
  if ! gcloud iam service-accounts keys create "${KEY_FILE}" \
      --iam-account "${SA_EMAIL}" --project "${ADMIN_PROJECT}"; then
    cat >&2 <<MSG

!! Key creation failed. The usual cause is an org policy:

   constraints/iam.disableServiceAccountKeyCreation

   Inspect it, and add an exception for this project, with:

     gcloud org-policies describe iam.disableServiceAccountKeyCreation \\
       --organization <ORG_ID>

   Also note constraints/iam.serviceAccountKeyExpiryHours, which caps how long
   a new key stays valid — if that one is enforced the key expires on its
   schedule and this script needs re-running with --force to rotate.
MSG
    exit 1
  fi
  chmod 600 "${KEY_FILE}"
fi

# ------------------------------------------------------------------ #
# 4. A gcloud configuration of its own
# ------------------------------------------------------------------ #
# Isolated so activating this SA never changes the account or project your
# `default` configuration uses for unrelated work.
if gcloud config configurations describe "${CONFIG_NAME}" >/dev/null 2>&1; then
  echo ">> gcloud configuration '${CONFIG_NAME}' already exists"
else
  echo ">> Creating gcloud configuration '${CONFIG_NAME}'"
  gcloud config configurations create "${CONFIG_NAME}" --no-activate
fi

echo ">> Activating ${SA_EMAIL} in '${CONFIG_NAME}'"
CLOUDSDK_ACTIVE_CONFIG_NAME="${CONFIG_NAME}" \
  gcloud auth activate-service-account --key-file "${KEY_FILE}"
CLOUDSDK_ACTIVE_CONFIG_NAME="${CONFIG_NAME}" \
  gcloud config set project "${ADMIN_PROJECT}" >/dev/null

cat <<MSG

>> Done.

The Makefile picks both of these up automatically — it exports
GOOGLE_APPLICATION_CREDENTIALS=${KEY_FILE} (for tofu, cloud-sql-proxy and the
runner) and CLOUDSDK_ACTIVE_CONFIG_NAME=${CONFIG_NAME} (for gcloud) whenever
they exist, so 'make infra', 'make ship' and 'make db-push' stop caring about
your human login.

For ad-hoc gcloud outside make:
  gcloud --configuration=${CONFIG_NAME} <command>
MSG
