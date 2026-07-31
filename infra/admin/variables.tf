variable "admin_project_id" {
  description = "Long-running admin project that owns the control plane and state."
  type        = string
}

variable "region" {
  description = "Region for Cloud SQL, Cloud Run, Artifact Registry, GCS."
  type        = string
  default     = "us-central1"
}

variable "workshops_folder_id" {
  description = "Numeric ID of the folder under which ephemeral workshop projects are created (runner-sa is scoped here)."
  type        = string
}

variable "billing_account_id" {
  description = "Billing account new workshop projects are linked to (format XXXXXX-XXXXXX-XXXXXX)."
  type        = string
}

variable "tfstate_bucket" {
  description = "GCS bucket (in the admin project) that holds per-run Terraform state for workshops."
  type        = string
}

variable "workspace_domain" {
  description = "Google Workspace domain attendee accounts are created in (e.g. example.com)."
  type        = string
}

variable "workspace_admin_email" {
  description = "Super-admin the runner impersonates via domain-wide delegation to call the Admin SDK."
  type        = string
}

variable "workspace_parent_ou" {
  description = "Parent org unit path the per-workshop OUs are created under."
  type        = string
  default     = "/"
}

variable "harness_account_id" {
  description = "Harness account identifier. Every workshop gets an organization here, with one project per attendee."
  type        = string
}

variable "harness_api_key" {
  description = "Harness API key (PAT or SAT) with rights to create organizations, projects, and invite users. Stored in Secret Manager."
  type        = string
  sensitive   = true
}

variable "harness_base_url" {
  description = "Harness base URL. Change for a non-SaaS or non-prod cluster (e.g. https://app.harness.io/gratis)."
  type        = string
  default     = "https://app.harness.io"
}

variable "db_tier" {
  description = "Cloud SQL machine tier. Postgres needs a custom/dedicated type (shared-core db-f1-micro/db-g1-small are MySQL-only). db-custom-1-3840 = 1 vCPU / 3.75 GB, the smallest valid Postgres tier."
  type        = string
  default     = "db-custom-1-3840"
}

variable "app_image" {
  description = "Container image for the Next.js app. Defaults to a placeholder so the first apply succeeds; replace once you push the real image."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "runner_image" {
  description = "Container image for tf-runner/tf-scheduler/tf-reaper. Defaults to a placeholder so the first apply succeeds; `make images` builds the real one."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "custom_domains" {
  description = "Domains to serve the app on, e.g. [\"harnessevents.io\", \"www.harnessevents.io\"]. Each gets a Cloud Run domain mapping and a managed cert. Which one is canonical is decided by app_url, not by the order here — the others 308 to it. Empty disables custom domains."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for d in var.custom_domains : can(regex("^[a-z0-9.-]+\\.[a-z]{2,}$", d))])
    error_message = "custom_domains must be bare hostnames — no scheme, port, or trailing slash (e.g. \"harnessevents.io\", not \"https://harnessevents.io/\")."
  }
}

variable "app_url" {
  description = "Public URL of the deployed app (from the app_url output after the first apply). Set this so Auth.js pins AUTH_URL instead of guessing the host."
  type        = string
  default     = ""
}

variable "site_admin_emails" {
  description = "Emails made site administrators when they sign in. Roles are otherwise granted from inside the app, so this is the bootstrap for the first administrator; it can be emptied once one exists."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for e in var.site_admin_emails : can(regex("^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$", e))])
    error_message = "site_admin_emails must be plain email addresses."
  }
}

variable "reaper_schedule" {
  description = "Cron schedule for the reaper that destroys expired workshop runs."
  type        = string
  default     = "*/5 * * * *"
}

variable "scheduler_schedule" {
  description = "Cron schedule for the provisioner that starts scheduled workshops."
  type        = string
  default     = "*/5 * * * *"
}

variable "google_oauth_client_id" {
  description = "Google OAuth 2.0 client ID for sign-in (stored in Secret Manager)."
  type        = string
  sensitive   = true
}

variable "google_oauth_client_secret" {
  description = "Google OAuth 2.0 client secret for sign-in (stored in Secret Manager)."
  type        = string
  sensitive   = true
}

# ---------------------------------------------------------------------------
# Continuous deployment (see cicd.tf for the one-time GitHub setup it needs)
# ---------------------------------------------------------------------------

variable "enable_cicd" {
  description = "Create the Cloud Build GitHub connection and push-to-main trigger. Leave false until the Cloud Build GitHub App is installed and the PAT secret exists."
  type        = bool
  default     = false
}

variable "github_owner" {
  description = "GitHub user or org that owns the repository (e.g. suchcodewow)."
  type        = string
  default     = ""
}

variable "github_repo" {
  description = "Repository name, without the owner (e.g. wsorchestrator)."
  type        = string
  default     = ""
}

variable "github_app_installation_id" {
  description = "Installation ID of the Cloud Build GitHub App on that repo — the number in the URL after installing https://github.com/apps/google-cloud-build."
  type        = string
  default     = ""
}

variable "github_pat_secret_id" {
  description = "NAME of the Secret Manager secret holding a GitHub PAT (scopes: repo, read:user) — e.g. \"github-pat\", not the token itself. The secret is created by hand, not by Terraform."
  type        = string
  default     = "github-pat"

  # The name invites pasting the token here instead of the secret's name, and
  # doing so fails deep inside the API with "does not match the expected
  # format [projects/*/secrets/*/versions/*]" — which does not point at the
  # cause. This is Secret Manager's actual id charset, so a token (which has
  # dots) is rejected immediately, with a message that says what to do.
  validation {
    condition     = can(regex("^[a-zA-Z0-9_-]{1,255}$", var.github_pat_secret_id))
    error_message = "github_pat_secret_id must be the NAME of a Secret Manager secret (letters, digits, '-' and '_' only), not the PAT value. Store the token first:\n  printf '%s' <GITHUB_TOKEN> | gcloud secrets create github-pat --data-file=- --project <ADMIN_PROJECT>\nthen set github_pat_secret_id = \"github-pat\"."
  }
}
