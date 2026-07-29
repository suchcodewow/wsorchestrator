# The GCP environment for a workshop: one ephemeral project, linked to billing,
# under the workshops folder. Attendee accounts are created in Google Workspace
# by the runner (Admin SDK), not here.
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
  activate_apis   = var.activate_apis
}
