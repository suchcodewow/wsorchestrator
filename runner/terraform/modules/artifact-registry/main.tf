resource "google_artifact_registry_repository" "images" {
  project       = var.project_id
  location      = var.region
  repository_id = "ws-images"
  format        = "DOCKER"
  description   = "Workshop Docker registry"
}
