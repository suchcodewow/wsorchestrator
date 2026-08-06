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
  attendee_emails = var.attendee_emails
}

# A small, cheap Kubernetes cluster for attendees to use. depends_on the whole
# project module so the container API is enabled and propagated first.
module "gke" {
  source       = "../../modules/gke"
  project_id   = module.project.project_id
  cluster_name = var.cluster_name
  region       = var.region
  zone_letter  = var.zone_letter
  labels       = var.labels

  depends_on = [module.project]
}
