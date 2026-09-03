# Continuous deployment: a push to main builds both images, applies the SQL
# migrations, and rolls Cloud Run onto the new tag.
#
# The pipeline itself lives in Harness — org `default`, project
# `default_project`, pipeline `deploy_workshop_orchestrator`. It clones this
# repo, builds and pushes both images to Artifact Registry, applies the SQL
# migrations, and updates Cloud Run, authenticating as build-sa via a JSON key
# held in Harness's own secret manager.
#
# Nothing about that pipeline is expressed here. Cloud Build's trigger, its
# GitHub App connection, and the repository link used to live in this file and
# were removed at the cutover — leaving them would have meant two systems
# racing to deploy the same commit. `cloudbuild.yaml` is kept at the repo root
# because `make images` still uses it for a manual build-and-push.
#
# What remains is only the IAM build-sa needs beyond building: `enable_cicd`
# gates these grants, so setting it false strips build-sa back to
# build-and-push and disables the Harness pipeline's deploy and migrate steps
# by removing their permissions.

locals {
  cicd = var.enable_cicd ? 1 : 0
}

# ---------------------------------------------------------------------------
# Extra permissions build-sa needs now that it deploys and migrates.
# It already has logWriter, artifactregistry.writer, and storage.objectViewer.
# ---------------------------------------------------------------------------

resource "google_project_iam_member" "build_deploy" {
  for_each = var.enable_cicd ? toset([
    "roles/run.admin",       # update the app service and the three jobs
    "roles/cloudsql.client", # open a cloud-sql-proxy connection for migrations
  ]) : toset([])

  project = var.admin_project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.build.email}"
}

# Updating a Cloud Run resource means re-declaring the service account it runs
# as, which requires actAs on it. Granted per-SA rather than project-wide so
# build-sa cannot impersonate anything else.
resource "google_service_account_iam_member" "build_acts_as" {
  for_each = var.enable_cicd ? {
    app    = google_service_account.app.name
    runner = google_service_account.runner.name
  } : {}

  service_account_id = each.value
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.build.email}"
}

# Migrations read the same `database-url` secret the app does.
resource "google_secret_manager_secret_iam_member" "build_db_url" {
  count = local.cicd

  secret_id = google_secret_manager_secret.s["database-url"].secret_id
  project   = var.admin_project_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.build.email}"
}
