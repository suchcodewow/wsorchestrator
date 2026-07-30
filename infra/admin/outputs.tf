output "app_url" {
  description = "Public URL of the Cloud Run app service."
  value       = google_cloud_run_v2_service.app.uri
}

output "admin_project_id" {
  value = var.admin_project_id
}

output "region" {
  value = var.region
}

output "app_service_account" {
  value = google_service_account.app.email
}

output "runner_service_account" {
  value = google_service_account.runner.email
}

output "scheduler_service_account" {
  value = google_service_account.scheduler.email
}

output "db_connection_name" {
  description = "Cloud SQL instance connection name (for cloud-sql-proxy / connector)."
  value       = google_sql_database_instance.main.connection_name
}

output "tfstate_bucket" {
  value = google_storage_bucket.tfstate.name
}

output "artifact_registry" {
  description = "Docker repo path to push images to."
  value       = local.artifact_registry
}

output "runner_job" {
  value = google_cloud_run_v2_job.runner.name
}

output "reaper_job" {
  value = google_cloud_run_v2_job.reaper.name
}

output "app_service" {
  description = "Cloud Run service name (what `make deploy` and the CD trigger update)."
  value       = google_cloud_run_v2_service.app.name
}

output "runner_jobs" {
  description = "Space-separated Cloud Run jobs that all run the runner image."
  value = join(" ", [
    google_cloud_run_v2_job.runner.name,
    google_cloud_run_v2_job.reaper.name,
    google_cloud_run_v2_job.scheduler.name,
  ])
}
