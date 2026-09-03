variable "admin_project_id" {
  description = "Long-running admin project that owns the control plane and state."
  type        = string
}

variable "region" {
  description = "Region for Cloud SQL, Cloud Run, Artifact Registry, GCS."
  type        = string
  default     = "us-central1"
}

variable "workshop_region" {
  description = "Region the runner builds each workshop's own resources in — its VPC and its GKE cluster. Separate from var.region, which is where this control plane lives: the admin project cannot move without rebuilding the database, while the workshops move freely and are moved off us-central1 because its GKE node capacity runs out too often. A run already built stays in the region it was built in."
  type        = string
  default     = "us-west1"
}

variable "gke_zones" {
  description = "Zone letters within workshop_region the runner tries in order when a zone is out of GKE node capacity. Empty uses the runner's own list for the region, which is the right answer for the regions it knows; set this when pointing workshop_region somewhere else (`gcloud compute zones list --filter=\"region:<region>\"`)."
  type        = string
  default     = ""
}

variable "workshops_folder_id" {
  description = "Numeric ID of the folder under which ephemeral workshop projects are created (runner-sa is scoped here)."
  type        = string
}

variable "billing_account_id" {
  description = "Billing account new workshop projects are linked to (format XXXXXX-XXXXXX-XXXXXX)."
  type        = string
}

variable "sandbox_project_id" {
  description = "Project id for the long-lived shared testing project no-cloud runs use. Leave empty to derive sbx-<admin_project_id>; set explicitly if that id is already taken (project ids are global and max 30 chars)."
  type        = string
  default     = ""
}

variable "sandbox_apis" {
  description = "APIs enabled on the shared testing project so attendees can use them."
  type        = list(string)
  default     = ["compute.googleapis.com"]
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

# --- Azure (required; every deployment carries all three clouds) ---
# Defaulted empty only so a partially-configured tree still plans; a run that
# selects Azure without these fails its preflight. Provisioning an Azure run
# needs a service principal with permissions on two planes:
#   * Azure RBAC, subscription scope: create resource groups + AKS AND create
#     role assignments. Contributor CANNOT create role assignments, so use
#     Owner (simplest), or Contributor + User Access Administrator. It must be
#     able to grant Owner, since challenge mode assigns competitors Owner.
#   * Microsoft Graph, application permission (admin-consented): User.ReadWrite.All
#     to create/delete attendee Entra users. (Directory.ReadWrite.All is a
#     broader superset, not required.)
# Also verify harnessevents.io in the tenant so attendee UPNs match their Google
# address.
variable "azure_subscription_id" {
  description = "Subscription workshop resource groups are created in. Empty leaves Azure off the runner and fails any Azure run at preflight."
  type        = string
  default     = ""
}

variable "azure_tenant_id" {
  description = "Entra tenant attendee users are created in."
  type        = string
  default     = ""
}

variable "azure_client_id" {
  description = "Service-principal (app) client id the azurerm/azuread providers authenticate with. Not a secret."
  type        = string
  default     = ""
}

variable "azure_client_secret" {
  description = "Service-principal client secret. Stored in Secret Manager; only created there when set."
  type        = string
  default     = ""
  sensitive   = true
}

variable "azure_location" {
  description = "Default Azure region for workshop resource groups and AKS clusters."
  type        = string
  default     = "eastus"
}

# --- AWS (required; every deployment carries all three clouds) ---
# Defaulted empty only so a partially-configured tree still plans; a run that
# selects AWS fails its preflight without these.
# Provisioning an AWS run needs credentials in the Organizations MANAGEMENT
# account with rights to create member accounts and assume
# OrganizationAccountAccessRole into them. The access key id + secret are stored
# in Secret Manager; region and OU are plaintext env on the runner.
variable "aws_access_key_id" {
  description = "Access key id for the Organizations management account. Empty leaves AWS off the runner and fails any AWS run at preflight. Not marked sensitive — it is the identifier half of the key pair (not the secret), so it can gate for_each; the secret access key is what's sensitive."
  type        = string
  default     = ""
}

variable "aws_secret_access_key" {
  description = "Secret access key paired with aws_access_key_id. Stored in Secret Manager."
  type        = string
  default     = ""
  sensitive   = true
}

variable "aws_region" {
  description = "Default AWS region for accounts and EKS clusters."
  type        = string
  default     = "us-east-1"
}

variable "aws_parent_ou_id" {
  description = "OU new member accounts are created under. Empty means the organization root."
  type        = string
  default     = ""
}

variable "aws_account_email_domain" {
  description = "Domain for new accounts' unique root emails (plus-addressed). Defaults to the Workspace domain when empty."
  type        = string
  default     = ""
}

variable "db_tier" {
  description = "Cloud SQL machine tier. Postgres needs a custom/dedicated type (shared-core db-f1-micro/db-g1-small are MySQL-only). db-custom-1-3840 = 1 vCPU / 3.75 GB, the smallest valid Postgres tier."
  type        = string
  default     = "db-custom-1-3840"
}

variable "db_backup_start_time" {
  description = "UTC HH:MM the daily Cloud SQL backup begins. Pick a quiet hour — a backup snapshots the instance, and the window least likely to overlap a workshop provisioning is the middle of the night."
  type        = string
  default     = "03:00"

  validation {
    condition     = can(regex("^([01][0-9]|2[0-3]):[0-5][0-9]$", var.db_backup_start_time))
    error_message = "db_backup_start_time must be 24-hour UTC HH:MM, e.g. \"03:00\"."
  }
}

variable "db_backup_retention_days" {
  description = "How many daily backups to keep, and how many days of write-ahead log to retain for point-in-time recovery. Seven covers the usual 'nobody noticed until Monday' case."
  type        = number
  default     = 7

  validation {
    # Cloud SQL caps transaction log retention at 35 days for PITR.
    condition     = var.db_backup_retention_days >= 1 && var.db_backup_retention_days <= 35
    error_message = "db_backup_retention_days must be between 1 and 35."
  }
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

variable "allowed_email_domains" {
  description = "Email domains allowed to sign in, unioned with the list administrators manage on the app's Admin settings page and always in force. Normally left empty and set from the app; this is the bootstrap, and the way back in if that list is ever wrong. Empty here and an empty table lets any Google account in. Addresses in site_admin_emails are always allowed regardless. Attendee pages are public and unaffected."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for d in var.allowed_email_domains : can(regex("^[^@\\s]+\\.[a-z]{2,}$", d))])
    error_message = "allowed_email_domains must be bare domains, without an @ or a local part."
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
# Continuous deployment
#
# The pipeline lives in Harness now, so it needs no GitHub wiring from this
# config: Harness holds its own repo connector. The four `github_*` variables
# below are read by nothing and are kept only so an existing terraform.tfvars
# that still sets them keeps applying cleanly. See cicd.tf.
# ---------------------------------------------------------------------------

variable "enable_cicd" {
  description = "Grant build-sa the extra IAM it needs to deploy and migrate (run.admin, cloudsql.client, actAs on app-sa/runner-sa, accessor on database-url). False strips it back to build-and-push, which disables the Harness pipeline's deploy and migrate steps by removing their permissions."
  type        = bool
  default     = false
}

variable "github_owner" {
  description = "Unused. GitHub user or org that owned the deleted Cloud Build connection."
  type        = string
  default     = ""
}

variable "github_repo" {
  description = "Unused. Repository name for the deleted Cloud Build connection."
  type        = string
  default     = ""
}

variable "github_app_installation_id" {
  description = "Unused. Installation ID of the Cloud Build GitHub App, which no longer needs to be installed."
  type        = string
  default     = ""
}

variable "github_pat_secret_id" {
  description = "Unused. NAME of the Secret Manager secret that held the PAT the deleted Cloud Build connection authenticated with — never the token itself. The `github-pat` secret it names was created by hand and is not managed here, so nothing removed it; delete it if nothing else reads it."
  type        = string
  default     = "github-pat"

  # Kept even though nothing reads the variable: the name invites pasting the
  # token here instead of the secret's name, and doing so used to fail deep
  # inside the API with "does not match the expected format
  # [projects/*/secrets/*/versions/*]", which did not point at the cause. This
  # is Secret Manager's actual id charset, so a token (which has dots) is
  # rejected immediately, with a message that says what to do.
  validation {
    condition     = can(regex("^[a-zA-Z0-9_-]{1,255}$", var.github_pat_secret_id))
    error_message = "github_pat_secret_id must be the NAME of a Secret Manager secret (letters, digits, '-' and '_' only), not the PAT value. Store the token first:\n  printf '%s' <GITHUB_TOKEN> | gcloud secrets create github-pat --data-file=- --project <ADMIN_PROJECT>\nthen set github_pat_secret_id = \"github-pat\"."
  }
}
