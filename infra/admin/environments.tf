# The two knobs that only matter because this module is applied twice, once for
# production and once for QA. Both are empty in production. See
# docs/environments.md for how the two deployments relate.

# Promotion reads QA's image rather than rebuilding it: the prod pipeline copies
# `<qa registry>/app:<sha>` into prod's registry, so what reaches production is
# byte-for-byte what was exercised on QA. That copy runs as production's
# build-sa, which therefore needs read on QA's repository — and only that.
resource "google_artifact_registry_repository_iam_member" "image_readers" {
  for_each = toset(var.image_readers)

  project    = var.admin_project_id
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.reader"
  member     = each.value
}

# Enough to debug a QA deploy without being able to change it: read everything,
# read logs, and open a Cloud SQL proxy with the app's own credentials
# (`scripts/with-db.sh`). Deploying stays with the pipeline.
locals {
  developer_roles = [
    "roles/viewer",
    "roles/logging.viewer",
    "roles/cloudsql.client",
  ]

  developer_bindings = {
    for pair in setproduct(var.developer_members, local.developer_roles) :
    "${pair[0]}|${pair[1]}" => { member = pair[0], role = pair[1] }
  }
}

resource "google_project_iam_member" "developers" {
  for_each = local.developer_bindings

  project = var.admin_project_id
  role    = each.value.role
  member  = each.value.member
}

resource "google_secret_manager_secret_iam_member" "developer_db_url" {
  for_each = toset(var.developer_members)

  project   = var.admin_project_id
  secret_id = google_secret_manager_secret.s["database-url"].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = each.value
}
