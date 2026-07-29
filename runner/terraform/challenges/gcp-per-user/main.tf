# The GCP environment for a challenge: one ephemeral project per competitor,
# each linked to billing under the workshops folder, with that competitor as
# its owner. Contrast with workshops/gcp-base, where every attendee shares a
# single project as editor.
#
# Competitor accounts are created in Google Workspace by the runner (Admin
# SDK), not here; the runner also decides each project id and passes the
# mapping in, so the ids stay stable across a re-apply.
provider "google" {
  region = var.region
}

module "project" {
  source   = "../../modules/project"
  for_each = var.attendee_projects

  project_id      = each.value
  folder_id       = var.folder_id
  billing_account = var.billing_account
  region          = var.region
  labels          = var.labels
  activate_apis   = var.activate_apis

  # Sole member of their own project, as its administrator.
  attendee_emails = [each.key]
  attendee_role   = "roles/owner"
}
