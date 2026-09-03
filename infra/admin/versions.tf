terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.12"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # No backend block on purpose. This module's state is held by the Harness
  # IaCM workspace `admin_control_plane` (org default, project default_project),
  # which supplies its own http backend at init time. A backend block committed
  # here would override that during pipeline execution and split the state in
  # two.
  #
  # It used to be `backend "gcs" {}`, filled in by scripts/bootstrap.sh with
  # gs://events-tfstate prefix admin. That state was migrated into the workspace
  # at serial 51; the GCS object is left in place, stale, as a rollback.
  #
  # To run tofu against this module by hand, see scripts/backend-local.sh — it
  # writes the git-ignored backend_local.tf that points the CLI at the same
  # Harness-held state the pipeline uses.
}
