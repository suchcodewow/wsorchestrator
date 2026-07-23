# Creates one ephemeral workshop project, links it to billing, and enables
# the APIs the workshop needs. deletion_policy=DELETE so the reaper's
# `terraform destroy` actually removes the project.
resource "google_project" "this" {
  name            = var.project_id
  project_id      = var.project_id
  folder_id       = var.folder_id
  billing_account = var.billing_account
  labels          = var.labels
  deletion_policy = "DELETE"
}

resource "google_project_service" "apis" {
  for_each = toset(var.activate_apis)

  project                    = google_project.this.project_id
  service                    = each.value
  disable_on_destroy         = false
  disable_dependent_services = true
}
