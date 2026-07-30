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
    # Was previously enabled out of band (whatever `gcloud builds submit` did
    # on first use). Declared now because the CD connection and trigger in
    # cicd.tf are created by Terraform and fail if the API is off.
    "cloudbuild.googleapis.com",
  ]
}

resource "google_project_service" "admin" {
  for_each = toset(local.admin_apis)

  project            = var.admin_project_id
  service            = each.value
  disable_on_destroy = false
}
