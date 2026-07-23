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
