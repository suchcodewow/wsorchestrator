resource "google_cloud_run_v2_service" "app" {
  name                = "workshop-orchestrator"
  location            = var.region
  project             = var.admin_project_id
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  # The running image tag is owned by whoever deployed last, not by Terraform.
  # Without this, any `terraform apply` — even one changing something unrelated
  # — would reset the service to var.app_image and silently roll production
  # backwards to whatever tag the operator happened to pass.
  #
  # Consequently `make deploy` no longer goes through Terraform; it calls
  # `gcloud run services update`, the same command the CD trigger uses. Rolling
  # back with `make deploy TAG=<older-sha>` still works, via that path.
  # var.app_image is now only the image this service is *created* with.
  #
  # `scaling` is ignored for a different reason: the config never declares it,
  # but the Cloud Run v2 API always answers with a service-level scaling block
  # filled in with its defaults, which refresh reads back into state. Terraform
  # then sees a block in state that is not in the config and plans to remove it
  # — an update that means nothing to the API, so the block is back on the next
  # read and the same diff returns forever. Nothing is actually drifting: zero
  # min instances is the default, and manual_instance_count is inert outside
  # MANUAL scaling mode.
  lifecycle {
    ignore_changes = [template[0].containers[0].image, scaling]
  }

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
          # The instance the backups page lists and restores. Derived from the
          # resource rather than configured, so the page can never be pointed
          # at an instance this deployment does not own.
          { CLOUD_SQL_INSTANCE = google_sql_database_instance.main.name },
          var.app_url != "" ? { AUTH_URL = var.app_url } : {},
          # Host part of app_url. The proxy redirects any other host here,
          # so www and the run.app URL converge on the one origin Auth.js and
          # the OAuth client agree on. Derived rather than configured
          # separately, so the canonical host can never disagree with AUTH_URL.
          var.app_url != "" ? { CANONICAL_HOST = local.canonical_host } : {},
          # Bootstrap for the first site administrator — everyone else's role
          # is granted from the app's users page.
          length(var.site_admin_emails) > 0
          ? { SITE_ADMIN_EMAILS = join(",", var.site_admin_emails) }
          : {},
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
