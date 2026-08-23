# The service account Harness builds the workshop's GCP project with.
#
# One per run: the runner hands its key to Harness as an org-scoped secret file
# and points a Google Cloud connector at it (see `linkGcpToHarness` in
# runner/src/run.ts), so every attendee's pipelines reach the project through
# this identity rather than through their own credentials.
#
# It lives in Terraform rather than in the runner's API calls because it must be
# torn down with everything else: `terraform destroy` deletes the account, and
# deleting an account revokes its keys — so the credential Harness holds stops
# working the moment the workshop is reaped, even for a project (the shared
# sandbox) that outlives the run.
resource "google_service_account" "this" {
  project      = var.project_id
  account_id   = var.account_id
  display_name = var.display_name
  description  = "Workshop Orchestrator: credentials for the event's Harness Google Cloud connector."
}

# Administrator of the project, which is what the labs need: pipelines create
# and destroy real infrastructure in here, not just read it.
resource "google_project_iam_member" "this" {
  project = var.project_id
  role    = var.role
  member  = "serviceAccount:${google_service_account.this.email}"
}

# The credential itself. Held in state (like the attendee passwords), which is
# how a retried or grown run re-uploads the same key instead of minting a new
# one and leaving the last one behind in Harness.
#
# Depends on the binding so the key is not handed out a moment before the
# account can do anything with it.
resource "google_service_account_key" "this" {
  service_account_id = google_service_account.this.name

  depends_on = [google_project_iam_member.this]
}
