# Holds the app and runner container images.
resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "workshop-orchestrator"
  format        = "DOCKER"
  project       = var.admin_project_id
  description   = "App and Terraform-runner images"

  # Keep the ten newest versions of each image (app, runner) and delete the
  # rest. Every build pushes one version per image, so this is the last ten
  # builds: enough to roll back with `make deploy TAG=<older-sha>` and, in QA,
  # for deploy_production to copy a recent tag from. The running revision and
  # jobs are always among them. A KEEP policy wins over a DELETE, so the
  # catch-all delete only ever reaches what falls outside the ten.
  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "delete-all"
    action = "DELETE"
    condition {
      tag_state = "ANY"
    }
  }

  cleanup_policies {
    id     = "keep-latest-10"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }

  depends_on = [google_project_service.admin]
}

locals {
  # The `<region>-docker.pkg.dev/<project>/<repo>` prefix every image tag is
  # built from. Defined once here because both the `artifact_registry` output
  # (which the Makefile reads) and the CD trigger's substitutions need it.
  artifact_registry = join("/", [
    "${var.region}-docker.pkg.dev",
    var.admin_project_id,
    google_artifact_registry_repository.images.repository_id,
  ])
}
