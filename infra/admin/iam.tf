# ------------------------------------------------------------------ #
# Service accounts
# ------------------------------------------------------------------ #

# Assumed by tf-runner and tf-reaper Cloud Run Jobs (no key files —
# the job runs AS this SA). Powerful inside the workshops folder, sealed
# outside it.
resource "google_service_account" "runner" {
  account_id   = "runner-sa"
  display_name = "Workshop Terraform runner"
  project      = var.admin_project_id
}

# Runtime identity for the Next.js Cloud Run service. Deliberately has NO
# project-creation power — it can only read/write the DB, read secrets, and
# trigger the tf-runner job.
resource "google_service_account" "app" {
  account_id   = "app-sa"
  display_name = "Workshop Orchestrator app"
  project      = var.admin_project_id
}

# Identity Cloud Scheduler uses to invoke the reaper job.
resource "google_service_account" "scheduler" {
  account_id   = "reaper-scheduler-sa"
  display_name = "Reaper scheduler"
  project      = var.admin_project_id
}

# ------------------------------------------------------------------ #
# runner-sa: broad WITHIN the workshops folder, contained OUTSIDE it
# ------------------------------------------------------------------ #

locals {
  # roles/owner is the "broad access for short-lived workshops" you approved.
  # Scoped to the FOLDER, so the blast radius is the workshops subtree only.
  runner_folder_roles = [
    "roles/resourcemanager.projectCreator",
    "roles/resourcemanager.projectDeleter",
    "roles/serviceusage.serviceUsageAdmin",
    "roles/owner",
  ]
}

resource "google_folder_iam_member" "runner_folder" {
  for_each = toset(local.runner_folder_roles)

  folder = "folders/${var.workshops_folder_id}"
  role   = each.value
  member = "serviceAccount:${google_service_account.runner.email}"
}

# Link newly created workshop projects to the billing account.
resource "google_billing_account_iam_member" "runner_billing" {
  billing_account_id = var.billing_account_id
  role               = "roles/billing.user"
  member             = "serviceAccount:${google_service_account.runner.email}"
}

# Read/write Terraform state in the admin bucket (cross-project actor).
resource "google_storage_bucket_iam_member" "runner_state" {
  bucket = google_storage_bucket.tfstate.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.runner.email}"
}

# runner-sa needs to reach the DB and emit logs from the job.
resource "google_project_iam_member" "runner_admin" {
  for_each = toset([
    "roles/cloudsql.client",
    "roles/logging.logWriter",
  ])

  project = var.admin_project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.runner.email}"
}

# ------------------------------------------------------------------ #
# app-sa: DB + logging only (plus secret/job access defined nearby)
# ------------------------------------------------------------------ #

resource "google_project_iam_member" "app_admin" {
  for_each = toset([
    "roles/cloudsql.client",
    "roles/logging.logWriter",
  ])

  project = var.admin_project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.app.email}"
}
