# Let the scheduler SA execute the reaper job.
resource "google_cloud_run_v2_job_iam_member" "scheduler_runs_reaper" {
  name     = google_cloud_run_v2_job.reaper.name
  location = var.region
  project  = var.admin_project_id
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

# Fire the reaper every few minutes to destroy expired workshop runs.
resource "google_cloud_scheduler_job" "reaper" {
  name    = "tf-reaper-trigger"
  project = var.admin_project_id
  region  = var.region

  schedule  = var.reaper_schedule
  time_zone = "Etc/UTC"

  http_target {
    http_method = "POST"
    uri = format(
      "https://%s-run.googleapis.com/v2/projects/%s/locations/%s/jobs/%s:run",
      var.region,
      var.admin_project_id,
      var.region,
      google_cloud_run_v2_job.reaper.name,
    )

    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }

  depends_on = [google_project_service.admin]
}

locals {
  # Any string will do as long as the app checks for the same one; a URL would
  # tie it to the host, and the app's URL is derived from the service this
  # value is an env var of.
  hibob_sync_audience = "workshop-orchestrator/hibob-sync"

  # app_url when set: with it, the app 308s every other host to it, and
  # Cloud Scheduler does not follow redirects.
  hibob_sync_url = format(
    "%s/api/evals/hibob/sync/scheduled",
    trimsuffix(var.app_url != "" ? var.app_url : google_cloud_run_v2_service.app.uri, "/"),
  )
}

# Sync eVals' employees from HiBob once a day. Unlike the jobs above this calls
# the app itself, which is public: the OIDC token is not for Cloud Run's IAM but
# for the app, which accepts it only from the scheduler SA with this audience.
# Each run logs itself on eVals settings' HiBob tab, including a failed one.
resource "google_cloud_scheduler_job" "hibob_sync" {
  name    = "hibob-sync-trigger"
  project = var.admin_project_id
  region  = var.region

  schedule  = var.hibob_sync_schedule
  time_zone = "America/New_York"

  # HiBob takes several seconds to send ~1,500 employees; the route allows 180.
  attempt_deadline = "300s"

  http_target {
    http_method = "POST"
    uri         = local.hibob_sync_url

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = local.hibob_sync_audience
    }
  }

  depends_on = [google_project_service.admin]
}

locals {
  canary_wire_pull_audience = "workshop-orchestrator/canary-wire-pull"
  canary_wire_pull_url = format(
    "%s/api/evals/canary-wire/pull/scheduled",
    trimsuffix(var.app_url != "" ? var.app_url : google_cloud_run_v2_service.app.uri, "/"),
  )
}

# Pull Reporting → Canary Wire from Mindtickle every two hours. A pull takes
# ~15 minutes and a call may run five, so the job fires in a burst: the first
# call starts the pull and each after it takes a step, each saving where it
# got to. Calls once it has finished do nothing. Only with a Mindtickle tenant
# set, like the secrets it needs.
resource "google_cloud_scheduler_job" "canary_wire_pull" {
  count   = var.mindtickle_company_id != "" ? 1 : 0
  name    = "canary-wire-pull-trigger"
  project = var.admin_project_id
  region  = var.region

  schedule  = var.canary_wire_pull_schedule
  time_zone = "America/New_York"

  # The route allows 300 seconds and works for 240 of them.
  attempt_deadline = "300s"

  http_target {
    http_method = "POST"
    uri         = local.canary_wire_pull_url

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = local.canary_wire_pull_audience
    }
  }

  depends_on = [google_project_service.admin]
}

# Let the scheduler SA execute the provisioner job.
resource "google_cloud_run_v2_job_iam_member" "scheduler_runs_provisioner" {
  name     = google_cloud_run_v2_job.scheduler.name
  location = var.region
  project  = var.admin_project_id
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

# Fire the provisioner every few minutes to start scheduled workshops on time.
resource "google_cloud_scheduler_job" "provisioner" {
  name    = "tf-scheduler-trigger"
  project = var.admin_project_id
  region  = var.region

  schedule  = var.scheduler_schedule
  time_zone = "Etc/UTC"

  http_target {
    http_method = "POST"
    uri = format(
      "https://%s-run.googleapis.com/v2/projects/%s/locations/%s/jobs/%s:run",
      var.region,
      var.admin_project_id,
      var.region,
      google_cloud_run_v2_job.scheduler.name,
    )

    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }

  depends_on = [google_project_service.admin]
}
