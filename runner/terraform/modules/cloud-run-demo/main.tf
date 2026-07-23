# Deploys a sample container to Cloud Run behind a public URL.
resource "google_cloud_run_v2_service" "demo" {
  project             = var.project_id
  name                = "ws-demo"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  project  = var.project_id
  name     = google_cloud_run_v2_service.demo.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
