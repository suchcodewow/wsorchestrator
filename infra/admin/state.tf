# Central bucket holding per-run Terraform state for every workshop.
# Layout written by tf-runner: workshops/<workshop-id>/<run-id>/default.tfstate
resource "google_storage_bucket" "tfstate" {
  name     = var.tfstate_bucket
  project  = var.admin_project_id
  location = var.region

  uniform_bucket_level_access = true
  force_destroy               = false

  versioning {
    enabled = true
  }

  depends_on = [google_project_service.admin]
}
