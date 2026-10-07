locals {
  admin_apis = [
    "cloudresourcemanager.googleapis.com",
    "cloudbilling.googleapis.com",
    "serviceusage.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    # Admin SDK Directory API — attendee accounts and per-workshop org units.
    # Billed against this project even though the call acts as a Workspace
    # super-admin, so it has to be on here.
    "admin.googleapis.com",
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
    # People API — at sign-in the app asks whether the account's Google photo is
    # one its owner chose or Google's generated initial. The call carries the
    # user's access token, so it counts against the project that owns the OAuth
    # client: production's, which QA shares. QA enabling it alone does nothing.
    # Without it the app falls back to whatever picture the ID token carries.
    "people.googleapis.com",
    # Calendar API — eVals Settings → Google Meetings creates its invites as
    # the Google account an administrator connected. Like the People API, the
    # calls carry that account's token, so they count against the project that
    # owns the OAuth client: production's, which QA shares.
    "calendar-json.googleapis.com",
  ]
}

resource "google_project_service" "admin" {
  for_each = toset(local.admin_apis)

  project            = var.admin_project_id
  service            = each.value
  disable_on_destroy = false
}
