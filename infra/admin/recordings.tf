# Async recordings: the bucket the Harness Training Recorder keeps video in
# (frontend/src/lib/recording/storage.ts). Named after the admin project, so
# QA and production each get their own with no variable to set.
#
# Participants' browsers upload chunks straight into it on V4 signed URLs the
# app hands out, and administrators download from it on signed URLs too; no
# video passes through Cloud Run. So the bucket stays private, the app's
# service account reads and writes it, and CORS lets the app's own origin PUT.
#
# Objects, and what removes them:
#   chunks/{take}/{kind}/{seq}     the app deletes them once a file is joined;
#   compose/{take}/{kind}/{n}      leftovers (an abandoned take) go after a week
#   files/{take}/{kind}.{ext}      the finished file: retention_days after it is made
locals {
  recordings_bucket = "${var.admin_project_id}-recordings"
  # The origins browsers upload from: the canonical app URL, and the custom
  # domains that redirect to it. Empty before the first deploy sets app_url.
  recordings_cors_origins = distinct(compact(concat(
    [var.app_url],
    [for d in var.custom_domains : "https://${d}"],
  )))
}

resource "google_storage_bucket" "recordings" {
  name     = local.recordings_bucket
  project  = var.admin_project_id
  location = var.region

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  cors {
    origin          = length(local.recordings_cors_origins) > 0 ? local.recordings_cors_origins : ["*"]
    method          = ["PUT", "GET", "HEAD"]
    response_header = ["Content-Type", "Content-Range", "Range"]
    max_age_seconds = 3600
  }

  # A recording is kept for recordings_retention_days, which must match
  # RECORDING_RETENTION_DAYS in frontend/src/lib/recording/video.ts: the app
  # deletes the row on the same schedule and hides it meanwhile.
  lifecycle_rule {
    condition {
      age            = var.recordings_retention_days
      matches_prefix = ["files/"]
    }
    action {
      type = "Delete"
    }
  }

  # Chunks and intermediate joins outlive their file only when a take was
  # abandoned mid-upload. A week leaves room for someone to reopen the link.
  lifecycle_rule {
    condition {
      age            = 7
      matches_prefix = ["chunks/", "compose/"]
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.admin]
}

# The app writes chunks' joins, reads sizes, lists and deletes.
resource "google_storage_bucket_iam_member" "app_recordings" {
  bucket = google_storage_bucket.recordings.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.app.email}"
}

# Signing upload and download URLs. On Cloud Run app-sa has no key, so it
# signs through IAM Credentials signBlob as itself, which needs tokenCreator
# ON ITSELF — the same arrangement runner_self_sign makes for runner-sa.
resource "google_service_account_iam_member" "app_self_sign" {
  service_account_id = google_service_account.app.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.app.email}"
}
