# Holds the app and runner container images.
resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "workshop-orchestrator"
  format        = "DOCKER"
  project       = var.admin_project_id
  description   = "App and Terraform-runner images"

  depends_on = [google_project_service.admin]
}

locals {
  # The `<region>-docker.pkg.dev/<project>/<repo>` prefix every image tag is
  # built from. Defined once here because both the `artifact_registry` output
  # (which the Makefile reads) and the CD trigger's substitutions need it.
  artifact_registry = join("/", [
    "${var.region}-docker.pkg.dev",
    var.admin_project_id,
    google_artifact_registry_repository.images.repository_id,
  ])
}
