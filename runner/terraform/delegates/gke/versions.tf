terraform {
  required_providers {
    google = {
      source = "hashicorp/google"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.17"
    }
  }
}
