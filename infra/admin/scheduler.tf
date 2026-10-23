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
  timed_jobs_audience = "workshop-orchestrator/timed-jobs"

  # app_url when set: with it, the app 308s every other host to it, and
  # Cloud Scheduler does not follow redirects.
  timed_jobs_tick_url = format(
    "%s/api/settings/timed-jobs/tick",
    trimsuffix(var.app_url != "" ? var.app_url : google_cloud_run_v2_service.app.uri, "/"),
  )
}

# Start the app's own timed jobs: the HiBob sync and the cohort Slack sync
# after it, the Google Meetings sync, and the Canary Wire's pull. Each one's
# schedule is set on Admin Settings → Timed Jobs and kept in the app's
# database; this calls the app every five minutes and it starts whichever
# fell due, claiming each time so a retry starts nothing twice. Unlike the
# jobs above this calls the app itself, which is public: the OIDC token is not
# for Cloud Run's IAM but for the app, which accepts it only from the
# scheduler SA with this audience.
resource "google_cloud_scheduler_job" "timed_jobs_tick" {
  name    = "timed-jobs-tick"
  project = var.admin_project_id
  region  = var.region

  schedule  = "*/5 * * * *"
  time_zone = "Etc/UTC"

  # The route allows 300 seconds and stops its jobs at 270.
  attempt_deadline = "300s"

  http_target {
    http_method = "POST"
    uri         = local.timed_jobs_tick_url

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = local.timed_jobs_audience
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
