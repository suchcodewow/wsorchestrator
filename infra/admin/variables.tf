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
  description = "Container image for tf-runner/tf-reaper. Placeholder until step #3 builds the real image."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "app_url" {
  description = "Public URL of the deployed app (from the app_url output after the first apply). Set this so Auth.js pins AUTH_URL instead of guessing the host."
  type        = string
  default     = ""
}

variable "reaper_schedule" {
  description = "Cron schedule for the reaper that destroys expired workshop runs."
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
