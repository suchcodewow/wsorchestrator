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

# Read-only view of the billing account's projects, for the admin "Cloud
# Status" page — it lists every project billed to this account and flags ones
# with no matching run in the database (orphans / extraneous projects). Viewer
# grants only list/get; app-sa still cannot change billing or move projects.
resource "google_billing_account_iam_member" "app_billing_viewer" {
  billing_account_id = var.billing_account_id
  role               = "roles/billing.viewer"
  member             = "serviceAccount:${google_service_account.app.email}"
}

# Read project display names for the Cloud Status page. roles/browser is
# metadata-only (project name / id / lifecycle — no data access), scoped to the
# workshops folder to match runner-sa's containment. Projects billed but outside
# this folder (the admin project, the sandbox, or one someone stood up elsewhere
# in the org) simply show without a name — grant this at the org level instead
# if naming those matters.
resource "google_folder_iam_member" "app_browser" {
  folder = "folders/${var.workshops_folder_id}"
  role   = "roles/browser"
  member = "serviceAccount:${google_service_account.app.email}"
}

# Read/write Terraform state in the admin bucket (cross-project actor).
resource "google_storage_bucket_iam_member" "runner_state" {
  bucket = google_storage_bucket.tfstate.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.runner.email}"
}

# Workspace domain-wide delegation without a key file: runner-sa signs its own
# delegation assertion through IAM Credentials signJwt (see
# runner/src/directory.ts), which means it is both the caller and the signed-for
# principal — so it needs tokenCreator ON ITSELF. Without this the Admin SDK is
# called as runner-sa rather than as the super-admin, and a bare service account
# has no Workspace customer: every Directory call fails "Invalid Customer Id".
#
# This is the GCP half only. The other half is in the Workspace Admin console
# (Security -> API controls -> Domain-wide delegation), where runner-sa's
# numeric client ID must be authorized for the admin.directory.orgunit and
# admin.directory.user scopes. Terraform cannot reach that.
resource "google_service_account_iam_member" "runner_self_sign" {
  service_account_id = google_service_account.runner.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.runner.email}"
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
    /*
     * Read the backup history, and restore from it, on the backups page.
     *
     * `editor`, not `admin`, and the gap matters: editor can restore an
     * existing instance but cannot delete one or rewrite its users. This is a
     * public-facing web app, so the difference between "a bug here can roll
     * the database back" and "a bug here can delete the database" is worth the
     * one role level.
     *
     * It is still the broadest thing app-sa holds. The restore endpoint is
     * administrator-only and demands the instance name typed back; see
     * `frontend/src/lib/backups.ts`.
     */
    "roles/cloudsql.editor",
  ])

  project = var.admin_project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.app.email}"
}
