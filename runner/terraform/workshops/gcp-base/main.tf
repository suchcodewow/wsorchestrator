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

# The identity the event's Harness Google Cloud connector authenticates as. Its
# key leaves here in a sensitive output, which the runner uploads to Harness and
# then drops (see `linkGcpToHarness`). count, so a deployment whose org policy
# forbids service account keys can turn the whole thing off by passing an empty
# service_account_id.
module "harness_sa" {
  source = "../../modules/harness-sa"
  count  = var.service_account_id == "" ? 0 : 1

  project_id   = module.project.project_id
  account_id   = var.service_account_id
  display_name = "Harness connector (${var.project_id})"
  role         = var.service_account_role

  depends_on = [module.project]
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
