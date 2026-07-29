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

# Newly enabled APIs report "enabled" before they're usable. Wait for them to
# propagate so resource creation (e.g. the first Cloud Run service) doesn't race
# a "has not been used in project" error. Dependents use depends_on = [module.project].
resource "time_sleep" "api_propagation" {
  depends_on      = [google_project_service.apis]
  create_duration = "60s"
}

# Attendees get editor on their workshop's project. These are additive
# (non-authoritative) bindings, so each attendee is granted independently and
# the project's own IAM is left alone.
#
# The accounts are created via the Admin SDK moments before this runs, and IAM
# rejects a member it cannot resolve yet, so this waits on the same propagation
# sleep the other resources use.
resource "google_project_iam_member" "attendees" {
  for_each = toset(var.attendee_emails)

  project = google_project.this.project_id
  role    = "roles/editor"
  member  = "user:${each.value}"

  depends_on = [time_sleep.api_propagation]
}
