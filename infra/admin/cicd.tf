# Continuous deployment: a push to main builds both images, applies the SQL
# migrations, and rolls Cloud Run onto the new tag.
#
# The pipeline itself lives in cloudbuild.yaml at the repo root — the same file
# `make images` uses. The deploy and migrate steps there are gated on the
# `_DEPLOY` substitution, which only this trigger sets, so a manual
# `make images` still just builds.
#
# ---------------------------------------------------------------------------
# ONE-TIME MANUAL SETUP (cannot be expressed in Terraform)
#
# Connecting a GitHub repo needs a GitHub App installation and a personal
# access token, neither of which the provider can create:
#
#   1. Install the Cloud Build GitHub App on the repository:
#        https://github.com/apps/google-cloud-build
#      Note the installation id from the URL it redirects to
#      (…/installations/<ID>) and set `github_app_installation_id`.
#
#   2. Create a classic PAT with `repo` + `read:user` scope, then store it:
#        printf '%s' <TOKEN> | gcloud secrets create github-pat \
#          --data-file=- --project <ADMIN_PROJECT>
#
#   3. Set `github_owner` / `github_repo` in terraform.tfvars and apply.
#
# Set `enable_cicd = false` to skip all of this and keep deploying by hand.
# ---------------------------------------------------------------------------

locals {
  cicd = var.enable_cicd ? 1 : 0

  # Cloud Build's own service agent — distinct from build-sa — is what reads
  # the PAT when brokering the GitHub connection.
  cloudbuild_agent = "service-${data.google_project.admin.number}@gcp-sa-cloudbuild.iam.gserviceaccount.com"
}

data "google_project" "admin" {
  project_id = var.admin_project_id
}

data "google_secret_manager_secret_version" "github_pat" {
  count   = local.cicd
  secret  = var.github_pat_secret_id
  project = var.admin_project_id
}

# The service agent needs to read the PAT secret. This is easy to miss: the org
# enforces `iam.automaticIamGrantsForDefaultServiceAccounts`, so nothing is
# granted implicitly and the connection fails with a bare permission error.
resource "google_secret_manager_secret_iam_member" "cloudbuild_pat" {
  count = local.cicd

  secret_id = var.github_pat_secret_id
  project   = var.admin_project_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.cloudbuild_agent}"
}

resource "google_cloudbuildv2_connection" "github" {
  count = local.cicd

  name     = "github"
  location = var.region
  project  = var.admin_project_id

  github_config {
    app_installation_id = var.github_app_installation_id

    authorizer_credential {
      oauth_token_secret_version = data.google_secret_manager_secret_version.github_pat[0].name
    }
  }

  depends_on = [
    google_secret_manager_secret_iam_member.cloudbuild_pat,
    google_project_service.admin,
  ]
}

resource "google_cloudbuildv2_repository" "repo" {
  count = local.cicd

  name              = var.github_repo
  location          = var.region
  project           = var.admin_project_id
  parent_connection = google_cloudbuildv2_connection.github[0].id
  remote_uri        = "https://github.com/${var.github_owner}/${var.github_repo}.git"
}

resource "google_cloudbuild_trigger" "deploy_on_push" {
  count = local.cicd

  name        = "deploy-on-push-main"
  description = "Build, migrate, and roll Cloud Run on every push to main."
  location    = var.region
  project     = var.admin_project_id

  # Runs as build-sa for the same reason `make images` does: the default Cloud
  # Build SA has no permissions under this org's policy.
  service_account = google_service_account.build.id

  repository_event_config {
    repository = google_cloudbuildv2_repository.repo[0].id
    push {
      branch = "^main$"
    }
  }

  filename = "cloudbuild.yaml"

  substitutions = {
    _REPO = local.artifact_registry
    # Built-in for triggered builds; the Makefile passes the same short SHA.
    _TAG         = "$SHORT_SHA"
    _DEPLOY      = "true"
    _REGION      = var.region
    _DB_CONN     = google_sql_database_instance.main.connection_name
    _APP_SERVICE = google_cloud_run_v2_service.app.name
    # Space-separated: all three jobs run the same runner image.
    _RUNNER_JOBS = join(" ", [
      google_cloud_run_v2_job.runner.name,
      google_cloud_run_v2_job.reaper.name,
      google_cloud_run_v2_job.scheduler.name,
    ])
  }
}

# ---------------------------------------------------------------------------
# Extra permissions build-sa needs now that it deploys and migrates.
# It already has logWriter, artifactregistry.writer, and storage.objectViewer.
# ---------------------------------------------------------------------------

resource "google_project_iam_member" "build_deploy" {
  for_each = var.enable_cicd ? toset([
    "roles/run.admin",       # update the app service and the three jobs
    "roles/cloudsql.client", # open a cloud-sql-proxy connection for migrations
  ]) : toset([])

  project = var.admin_project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.build.email}"
}

# Updating a Cloud Run resource means re-declaring the service account it runs
# as, which requires actAs on it. Granted per-SA rather than project-wide so
# build-sa cannot impersonate anything else.
resource "google_service_account_iam_member" "build_acts_as" {
  for_each = var.enable_cicd ? {
    app    = google_service_account.app.name
    runner = google_service_account.runner.name
  } : {}

  service_account_id = each.value
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.build.email}"
}

# Migrations read the same `database-url` secret the app does.
resource "google_secret_manager_secret_iam_member" "build_db_url" {
  count = local.cicd

  secret_id = google_secret_manager_secret.s["database-url"].secret_id
  project   = var.admin_project_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.build.email}"
}
