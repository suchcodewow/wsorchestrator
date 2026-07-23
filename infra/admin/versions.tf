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

  # Admin infra state lives in a GCS bucket that must exist BEFORE the first
  # apply (chicken-and-egg). Create it once with scripts/bootstrap.sh, then:
  #   terraform init -backend-config="bucket=<admin-infra-tfstate>" \
  #                  -backend-config="prefix=admin"
  backend "gcs" {}
}
