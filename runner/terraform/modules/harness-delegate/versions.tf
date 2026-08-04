# Helm only — the caller configures the `helm` provider (its embedded
# `kubernetes` block) against whichever cluster the delegate is going into, so
# this module needs no cloud provider of its own. Pinned to the 2.x line: the
# `set {}` / nested `kubernetes {}` block syntax used here changed in helm 3.x.
terraform {
  required_providers {
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.17"
    }
  }
}
