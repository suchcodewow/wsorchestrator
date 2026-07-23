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
  activate_apis   = ["run.googleapis.com"]
}

module "demo" {
  source     = "../../modules/cloud-run-demo"
  project_id = module.project.project_id
  region     = var.region

  depends_on = [module.project]
}
