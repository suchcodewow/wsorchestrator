# Dedicated Cloud Build service account. Required because the org policy
# `iam.automaticIamGrantsForDefaultServiceAccounts` is enforced, so Cloud
# Build's default SA has no permissions and `gcloud builds submit` is rejected.
# The operator (project owner/editor) can actAs this SA, and the Makefile
# passes it via --service-account.
resource "google_service_account" "build" {
  account_id   = "build-sa"
  display_name = "Cloud Build"
  project      = var.admin_project_id
}

resource "google_project_iam_member" "build" {
  for_each = toset([
    "roles/logging.logWriter",       # write build logs (CLOUD_LOGGING_ONLY)
    "roles/artifactregistry.writer", # push app + runner images
    "roles/storage.objectViewer",    # read uploaded source from staging bucket
  ])

  project = var.admin_project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.build.email}"
}
