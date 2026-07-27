resource "google_cloud_run_v2_service" "app" {
  name                = "workshop-orchestrator"
  location            = var.region
  project             = var.admin_project_id
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.app.email

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [local.cloudsql_connection]
      }
    }

    containers {
      image = var.app_image

      ports {
        # Next.js standalone honors $PORT, which Cloud Run injects.
        container_port = 8080
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      # Auth.js v5 behind Cloud Run: trust forwarded headers, and — once the
      # service URL is known — pin AUTH_URL so redirect_uri is never guessed
      # (host-guessing can yield 0.0.0.0:8080, which Google rejects).
      env {
        name  = "AUTH_TRUST_HOST"
        value = "true"
      }

      dynamic "env" {
        for_each = merge(
          local.runner_env,
          { TF_RUNNER_JOB = google_cloud_run_v2_job.runner.name },
          var.app_url != "" ? { AUTH_URL = var.app_url } : {},
        )
        content {
          name  = env.key
          value = env.value
        }
      }

      # Secret-backed env vars.
      dynamic "env" {
        for_each = {
          DATABASE_URL       = "database-url"
          AUTH_SECRET        = "auth-secret"
          AUTH_GOOGLE_ID     = "google-oauth-client-id"
          AUTH_GOOGLE_SECRET = "google-oauth-client-secret"
        }
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.s[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }

  depends_on = [google_project_service.admin]
}

# Public web app — anyone can reach the sign-in page; auth is enforced in-app.
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.app.name
  location = var.region
  project  = var.admin_project_id
  role     = "roles/run.invoker"
  member   = "allUsers"
}
