# mimir-studio: Mimir Studio's job (scripts/explainer-video/studio). One
# execution does one row of mimir_studio_jobs, named by the JOB_ID the app
# passes: a deck job reads an uploaded slide deck and drafts a new concept map
# from it, and a video job has Claude write, narrate, render and check one
# concept's explainer video. Both read and write the recordings bucket, under
# mimir/; see the note at the top of recordings.tf.
#
# It spends two keys, Claude's and ElevenLabs', so it exists only when both
# are set; without it the app leaves MIMIR_STUDIO_JOB unset and Mimir Settings
# says the studio is not set up.
locals {
  studio_enabled = nonsensitive(var.anthropic_api_key != "" && var.eleven_labs_token != "")

  studio_secret_env = {
    DATABASE_URL      = "database-url"
    ANTHROPIC_API_KEY = "anthropic-api-key"
    ELEVEN_LABS_TOKEN = "eleven-labs-token"
  }
}

# Its own account, so the keys it reads and the bucket it writes are its alone
# among the jobs: runner-sa has no use for either key.
resource "google_service_account" "studio" {
  account_id   = "mimir-studio-sa"
  display_name = "Mimir Studio"
  project      = var.admin_project_id
}

resource "google_project_iam_member" "studio" {
  for_each = toset([
    "roles/cloudsql.client",
    "roles/logging.logWriter",
  ])

  project = var.admin_project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.studio.email}"
}

# It reads the uploaded deck and the reference videos' sources, writes slide
# pictures, drafts and finished videos, and deletes its scratch objects.
resource "google_storage_bucket_iam_member" "studio_recordings" {
  bucket = google_storage_bucket.recordings.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.studio.email}"
}

resource "google_secret_manager_secret_iam_member" "studio" {
  for_each = local.studio_enabled ? local.studio_secret_env : {}

  secret_id = google_secret_manager_secret.s[each.value].secret_id
  project   = var.admin_project_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.studio.email}"
}

resource "google_cloud_run_v2_job" "studio" {
  count = local.studio_enabled ? 1 : 0

  name                = "mimir-studio"
  location            = var.region
  project             = var.admin_project_id
  deletion_protection = false

  # See the matching note in runner.tf: the deploy pipelines own the image.
  lifecycle {
    ignore_changes = [
      template[0].template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  template {
    template {
      service_account = google_service_account.studio.email
      # A video job renders the whole video at least once and every scene's
      # stills more than that; three hours leaves room for a second render.
      # The app gives a job up after four without word from it.
      timeout     = "10800s"
      max_retries = 0

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [local.cloudsql_connection]
        }
      }

      containers {
        image = var.studio_image

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }

        env {
          name  = "RECORDINGS_BUCKET"
          value = google_storage_bucket.recordings.name
        }
        # Browser tabs Remotion renders with. Each is a Chromium renderer, so
        # this is what the memory below is sized for.
        env {
          name  = "STUDIO_RENDER_CONCURRENCY"
          value = "4"
        }

        dynamic "env" {
          for_each = local.studio_secret_env
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

        # Rendering is the heavy part: Chromium tabs, ffmpeg, and the
        # workspace itself, which Cloud Run's in-memory filesystem charges
        # here too. A deck job's LibreOffice is small beside it.
        resources {
          limits = {
            cpu    = "8"
            memory = "16Gi"
          }
        }
      }
    }
  }

  # As for the runner's jobs: Cloud Run checks every secret ref on update.
  depends_on = [
    google_project_service.admin,
    google_secret_manager_secret_version.v,
    google_secret_manager_secret_iam_member.studio,
    google_project_iam_member.studio,
  ]
}

# The app starts the job with a JOB_ID override, which needs
# run.jobs.runWithOverrides; roles/run.developer on this job has it.
resource "google_cloud_run_v2_job_iam_member" "app_runs_studio" {
  count = local.studio_enabled ? 1 : 0

  name     = google_cloud_run_v2_job.studio[0].name
  location = var.region
  project  = var.admin_project_id
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.app.email}"
}
