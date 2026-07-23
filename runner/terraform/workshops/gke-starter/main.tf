provider "google" {
  region = var.region
}

module "project" {
  source          = "../../modules/project"
  project_id      = var.project_id
  folder_id       = var.folder_id
  billing_account = var.billing_account
  region          = var.region
  labels          = var.labels
  activate_apis = [
    "compute.googleapis.com",
    "container.googleapis.com",
    "artifactregistry.googleapis.com",
  ]
}

module "gke" {
  source     = "../../modules/gke-starter"
  project_id = module.project.project_id
  region     = var.region

  # Wait for project + APIs before creating resources.
  depends_on = [module.project]
}
