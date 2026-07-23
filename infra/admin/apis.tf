locals {
  admin_apis = [
    "cloudresourcemanager.googleapis.com",
    "cloudbilling.googleapis.com",
    "serviceusage.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sqladmin.googleapis.com",
    "run.googleapis.com",
    "cloudscheduler.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "compute.googleapis.com",
  ]
}

resource "google_project_service" "admin" {
  for_each = toset(local.admin_apis)

  project            = var.admin_project_id
  service            = each.value
  disable_on_destroy = false
}
