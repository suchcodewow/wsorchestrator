# Holds the app and runner container images.
resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "workshop-orchestrator"
  format        = "DOCKER"
  project       = var.admin_project_id
  description   = "App and Terraform-runner images"

  depends_on = [google_project_service.admin]
}
