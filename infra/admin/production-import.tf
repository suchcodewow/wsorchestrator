# Importing one of production's backups into QA, from QA's Backups page.
#
# Two halves, one in each deployment:
#
#   QA (production_backup_project set): runner-sa may pause its own triggers,
#   back up and restore its own instance, and reset appuser's password, which
#   a restore replaces with production's. The app is told where production's
#   backups are, and which identity may call its finish step.
#
#   Production (backup_reader_members set): QA's app-sa and runner-sa may list
#   and read production's backups. Read only: neither can restore, export or
#   connect to production's instance.
#
# Both are empty by default, so neither deployment has any of this until it is
# set. The guardrails themselves are in code: `runner/src/import-production.ts`
# and `frontend/src/lib/production-import.ts`. See docs/environments.md.

locals {
  production_import = var.production_backup_project != ""

  # Must match FINISH_AUDIENCE in runner/src/import-production.ts.
  production_import_audience = "workshop-orchestrator/production-import"
}

# Everything the import job does to its own deployment, and nothing more.
# `cloudsql.editor` would cover the backup and the restore but not the password,
# and `cloudsql.admin` could delete the instance.
resource "google_project_iam_custom_role" "production_import" {
  count = local.production_import ? 1 : 0

  project     = var.admin_project_id
  role_id     = "workshopProductionImport"
  title       = "Workshop Orchestrator production import"
  description = "Lets the runner replace this deployment's database with a production backup. See infra/admin/production-import.tf."
  permissions = [
    "cloudsql.backupRuns.create",
    "cloudsql.backupRuns.get",
    "cloudsql.backupRuns.list",
    "cloudsql.instances.get",
    "cloudsql.instances.restoreBackup",
    "cloudsql.users.update",
    "cloudscheduler.jobs.enable",
    "cloudscheduler.jobs.get",
    "cloudscheduler.jobs.pause",
    "run.executions.list",
    "run.jobs.get",
  ]
}

resource "google_project_iam_member" "runner_production_import" {
  count = local.production_import ? 1 : 0

  project = var.admin_project_id
  role    = google_project_iam_custom_role.production_import[0].id
  member  = "serviceAccount:${google_service_account.runner.email}"
}

# Production's side: let QA read the backups it may import.
resource "google_project_iam_member" "backup_readers" {
  for_each = toset(var.backup_reader_members)

  project = var.admin_project_id
  role    = "roles/cloudsql.viewer"
  member  = each.value
}
