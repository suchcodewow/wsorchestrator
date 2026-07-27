locals {
  # Config the runner/reaper need to create projects and write state.
  runner_env = {
    GCP_ADMIN_PROJECT_ID    = var.admin_project_id
    GCP_WORKSHOPS_FOLDER_ID = var.workshops_folder_id
    GCP_BILLING_ACCOUNT_ID  = var.billing_account_id
    GCP_TFSTATE_BUCKET      = google_storage_bucket.tfstate.name
    GCP_REGION              = var.region
  }

  cloudsql_connection = google_sql_database_instance.main.connection_name
}

# tf-runner: provisions one workshop run (project -> billing -> APIs -> apply).
resource "google_cloud_run_v2_job" "runner" {
  name                = "tf-runner"
  location            = var.region
  project             = var.admin_project_id
  deletion_protection = false

  template {
    template {
      service_account = google_service_account.runner.email
      timeout         = "3600s"
      max_retries     = 0

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [local.cloudsql_connection]
        }
      }

      containers {
        image = var.runner_image
        args  = ["run"]

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }

        dynamic "env" {
          for_each = local.runner_env
          content {
            name  = env.key
            value = env.value
          }
        }

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.s["database-url"].secret_id
              version = "latest"
            }
          }
        }

        resources {
          limits = {
            cpu    = "1"
            memory = "1Gi"
          }
        }
      }
    }
  }

  depends_on = [google_project_service.admin]
}

# tf-reaper: destroys runs past their TTL (terraform destroy + project delete).
resource "google_cloud_run_v2_job" "reaper" {
  name                = "tf-reaper"
  location            = var.region
  project             = var.admin_project_id
  deletion_protection = false

  template {
    template {
      service_account = google_service_account.runner.email
      timeout         = "1800s"
      max_retries     = 0

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [local.cloudsql_connection]
        }
      }

      containers {
        image = var.runner_image
        args  = ["reap"]

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }

        dynamic "env" {
          for_each = local.runner_env
          content {
            name  = env.key
            value = env.value
          }
        }

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.s["database-url"].secret_id
              version = "latest"
            }
          }
        }

        resources {
          limits = {
            cpu    = "1"
            memory = "1Gi"
          }
        }
      }
    }
  }

  depends_on = [google_project_service.admin]
}

# The app service triggers workshop runs by executing the tf-runner job WITH a
# RUN_ID container override, which needs run.jobs.runWithOverrides. Plain
# roles/run.invoker lacks it; roles/run.developer (scoped to this job) has it.
resource "google_cloud_run_v2_job_iam_member" "app_runs_runner" {
  name     = google_cloud_run_v2_job.runner.name
  location = var.region
  project  = var.admin_project_id
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.app.email}"
}
