# A single long-lived project that runs created with no cloud selected grant
# their attendees access to (see the runner's workshops/gcp-sandbox config).
#
# Unlike the ephemeral per-run projects, this one is never torn down — it exists
# so testing runs can skip the slow create-project / destroy-project cycle. The
# runner only ever adds and removes attendee IAM bindings on it.
locals {
  # Project ids are globally unique and capped at 30 chars; derive one from the
  # admin project when not set explicitly. Override `sandbox_project_id` in
  # terraform.tfvars if the derived id is taken.
  sandbox_project_id = (
    var.sandbox_project_id != ""
    ? var.sandbox_project_id
    : "sbx-${var.admin_project_id}"
  )
}

resource "google_project" "sandbox" {
  name            = local.sandbox_project_id
  project_id      = local.sandbox_project_id
  folder_id       = var.workshops_folder_id
  billing_account = var.billing_account_id

  # Long-lived by design: refuse to delete it on `terraform destroy`, so a
  # stray apply can never take the shared testing project down.
  deletion_policy = "PREVENT"

  labels = {
    managed_by = "workshop-orchestrator"
    purpose    = "shared-testing-sandbox"
  }
}

resource "google_project_service" "sandbox_apis" {
  for_each = toset(var.sandbox_apis)

  project                    = google_project.sandbox.project_id
  service                    = each.value
  disable_on_destroy         = false
  disable_dependent_services = true
}

# The runner grants and revokes attendee editor on this project via Terraform,
# which needs permission to set its IAM policy.
resource "google_project_iam_member" "runner_sandbox_admin" {
  project = google_project.sandbox.project_id
  role    = "roles/resourcemanager.projectIamAdmin"
  member  = "serviceAccount:${google_service_account.runner.email}"
}

output "sandbox_project_id" {
  value = google_project.sandbox.project_id
}
