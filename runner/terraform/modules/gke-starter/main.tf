# A small GKE Autopilot cluster on a dedicated VPC, plus an Artifact Registry
# repo — a realistic "starter cluster" workshop.
resource "google_compute_network" "vpc" {
  project                 = var.project_id
  name                    = "ws-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "subnet" {
  project       = var.project_id
  name          = "ws-subnet"
  region        = var.region
  network       = google_compute_network.vpc.id
  ip_cidr_range = "10.10.0.0/20"
}

resource "google_container_cluster" "autopilot" {
  project    = var.project_id
  name       = "ws-cluster"
  location   = var.region
  network    = google_compute_network.vpc.id
  subnetwork = google_compute_subnetwork.subnet.id

  enable_autopilot    = true
  deletion_protection = false

  # VPC-native; let GKE manage the secondary ranges.
  ip_allocation_policy {}
}

resource "google_artifact_registry_repository" "images" {
  project       = var.project_id
  location      = var.region
  repository_id = "ws-images"
  format        = "DOCKER"
}
