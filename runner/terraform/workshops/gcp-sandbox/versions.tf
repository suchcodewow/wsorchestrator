# Same providers and pins as gcp-base (its lock file is copied in), so the
# runner resolves them the same way. This config has no module, so it declares
# the providers itself rather than inheriting them.
terraform {
  required_providers {
    google = {
      source = "hashicorp/google"
    }
    time = {
      source = "hashicorp/time"
    }
  }
}
