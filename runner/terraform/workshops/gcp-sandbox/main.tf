# Grants a run's attendees access to a single long-lived "sandbox" project,
# used when a run is created with no cloud selected. This is for fast testing:
# it skips the slow create-project / destroy-project cycle entirely.
#
# The defining property, versus gcp-base: this config never manages the project
# itself — only additive `google_project_iam_member` bindings for the run's own
# attendees. So `terraform destroy` at teardown removes just those grants and
# cannot touch the shared project or anyone else's bindings. Two runs can share
# the project at once; each run's state owns only its own attendees' access.
provider "google" {
  region = var.region
}

# The attendee accounts are created via the Admin SDK moments before this runs,
# and IAM rejects a member it cannot resolve yet, so wait for them to propagate
# before binding — the same guard gcp-base relies on. Keyed on the attendee set
# so a grown workshop waits again for its newly added accounts.
resource "time_sleep" "account_propagation" {
  create_duration = "60s"

  triggers = {
    attendees = join(",", sort(var.attendee_emails))
  }
}

resource "google_project_iam_member" "attendees" {
  for_each = toset(var.attendee_emails)

  project = var.project_id
  role    = var.attendee_role
  member  = "user:${each.value}"

  depends_on = [time_sleep.account_propagation]
}
