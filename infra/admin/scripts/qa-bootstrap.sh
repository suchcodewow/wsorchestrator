#!/usr/bin/env bash
# One-time: stand up the empty shell the QA environment's Terraform runs in.
#
# QA is the same infra/admin module applied a second time, into its own admin
# project, by its own IaCM workspace (qa_control_plane). Every resource the
# module creates is named inside `admin_project_id`, so a second project is a
# second, fully separate environment: its own Cloud SQL, secrets, Cloud Run,
# registry and runner-sa. What the module cannot create is the project it lives
# in, the folders around it, and the identity that applies it. This makes those.
#
#   folders/522401695842  (workshops — prod's runs land directly in here)
#   └── orchestrator-qa   (QA_FOLDER)
#       ├── harnessevents-qa     (QA admin project)
#       └── qa-workshops         (QA_WORKSHOPS_FOLDER — QA's runs land here)
#
# tf-admin-qa is QA's tf-admin-sa: owner on the QA project, folder admin on the
# QA folder, and billing.USER (not admin) on the shared billing account. It can
# link a project to billing but cannot grant billing roles, so the module runs
# with manage_billing_iam = false and the two billing grants QA's own runner-sa
# and app-sa need are made here, by the caller, once they exist (--grant-billing).
#
# Run as tf-admin-sa (it has folderAdmin + projectCreator on the workshops
# folder and billing.admin):
#
#   CLOUDSDK_ACTIVE_CONFIG_NAME=workshop-orchestrator ./scripts/qa-bootstrap.sh
#   # ... first apply of qa_control_plane ...
#   CLOUDSDK_ACTIVE_CONFIG_NAME=workshop-orchestrator ./scripts/qa-bootstrap.sh --grant-billing
#
# Idempotent: every step checks or tolerates what already exists.
set -euo pipefail

PARENT_FOLDER="${PARENT_FOLDER:-522401695842}"
QA_PROJECT="${QA_PROJECT:-harnessevents-qa}"
BILLING_ACCOUNT_ID="${BILLING_ACCOUNT_ID:-0175E2-FBAB8D-653C7C}"
SA_ID="${SA_ID:-tf-admin-qa}"
KEY_FILE="${KEY_FILE:-$HOME/.config/gcloud/workshop-tf-admin-qa.json}"
# Owner on the QA project, so the people building on it can read logs and poke
# at Cloud Run without a ticket. QA holds no production data.
QA_OWNERS="${QA_OWNERS:-group:300@harnessevents.io}"

SA_EMAIL="${SA_ID}@${QA_PROJECT}.iam.gserviceaccount.com"
MEMBER="serviceAccount:${SA_EMAIL}"

folder_id() { # parent display-name
  gcloud resource-manager folders list --folder="$1" \
    --filter="displayName=$2" --format="value(name)" | sed 's#folders/##'
}

ensure_folder() { # parent display-name
  local id
  id="$(folder_id "$1" "$2")"
  if [ -z "$id" ]; then
    gcloud resource-manager folders create --display-name="$2" --folder="$1" >/dev/null
    id="$(folder_id "$1" "$2")"
  fi
  echo "$id"
}

if [ "${1:-}" = "--grant-billing" ]; then
  # QA's runner-sa creates each run's project and links it to billing; QA's
  # app-sa lists the account's projects on the Cloud Status page. In prod the
  # module grants these (iam.tf); in QA, tf-admin-qa cannot.
  for pair in "runner-sa:roles/billing.user" "app-sa:roles/billing.viewer"; do
    sa="${pair%%:*}"; role="${pair#*:}"
    echo ">> Granting ${role} to ${sa}@${QA_PROJECT} on ${BILLING_ACCOUNT_ID}"
    gcloud billing accounts add-iam-policy-binding "${BILLING_ACCOUNT_ID}" \
      --member "serviceAccount:${sa}@${QA_PROJECT}.iam.gserviceaccount.com" \
      --role "${role}" >/dev/null
  done
  exit 0
fi

echo ">> Folders"
QA_FOLDER="$(ensure_folder "${PARENT_FOLDER}" orchestrator-qa)"
QA_WORKSHOPS_FOLDER="$(ensure_folder "${QA_FOLDER}" qa-workshops)"
echo "   orchestrator-qa = ${QA_FOLDER}"
echo "   qa-workshops    = ${QA_WORKSHOPS_FOLDER}"

echo ">> Project ${QA_PROJECT}"
if ! gcloud projects describe "${QA_PROJECT}" >/dev/null 2>&1; then
  gcloud projects create "${QA_PROJECT}" --folder="${QA_FOLDER}" \
    --name="Workshop Orchestrator QA"
fi
gcloud billing projects link "${QA_PROJECT}" --billing-account="${BILLING_ACCOUNT_ID}" >/dev/null

# Enough for tf-admin-qa to enable the rest itself (apis.tf).
echo ">> Bootstrap APIs"
gcloud services enable --project "${QA_PROJECT}" \
  cloudresourcemanager.googleapis.com serviceusage.googleapis.com \
  cloudbilling.googleapis.com iam.googleapis.com iamcredentials.googleapis.com

echo ">> Service account ${SA_EMAIL}"
if ! gcloud iam service-accounts describe "${SA_EMAIL}" --project "${QA_PROJECT}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${SA_ID}" --project "${QA_PROJECT}" \
    --display-name "QA Terraform operator (workshop-orchestrator)"
fi

gcloud projects add-iam-policy-binding "${QA_PROJECT}" \
  --member "${MEMBER}" --role roles/owner --condition=None >/dev/null
for m in ${QA_OWNERS}; do
  gcloud projects add-iam-policy-binding "${QA_PROJECT}" \
    --member "${m}" --role roles/owner --condition=None >/dev/null
done

# The same four folder roles tf-admin-sa holds on the workshops folder, on the
# QA folder instead — which covers qa-workshops below it and nothing of prod's.
for role in \
  roles/resourcemanager.folderAdmin \
  roles/resourcemanager.projectCreator \
  roles/resourcemanager.projectDeleter \
  roles/serviceusage.serviceUsageAdmin
do
  gcloud resource-manager folders add-iam-policy-binding "${QA_FOLDER}" \
    --member "${MEMBER}" --role "${role}" --condition=None >/dev/null
done

# billing.user: link the QA sandbox project (sandbox.tf) to billing.
gcloud billing accounts add-iam-policy-binding "${BILLING_ACCOUNT_ID}" \
  --member "${MEMBER}" --role roles/billing.user >/dev/null

mkdir -p "$(dirname "${KEY_FILE}")"
if [ -s "${KEY_FILE}" ]; then
  echo ">> Key already present at ${KEY_FILE}"
else
  echo ">> Creating key at ${KEY_FILE}"
  gcloud iam service-accounts keys create "${KEY_FILE}" \
    --iam-account "${SA_EMAIL}" --project "${QA_PROJECT}"
  chmod 600 "${KEY_FILE}"
fi

cat <<MSG

>> Done. For the qa_control_plane workspace:
     admin_project_id    = "${QA_PROJECT}"
     workshops_folder_id = "${QA_WORKSHOPS_FOLDER}"
   The key at ${KEY_FILE} backs the Harness connector gcp_tf_admin_qa.
MSG
