locals {
  # Config the runner/reaper need to create projects, Workspace accounts, and
  # write state.
  runner_env = {
    GCP_ADMIN_PROJECT_ID    = var.admin_project_id
    GCP_WORKSHOPS_FOLDER_ID = var.workshops_folder_id
    GCP_BILLING_ACCOUNT_ID  = var.billing_account_id
    GCP_TFSTATE_BUCKET      = google_storage_bucket.tfstate.name
    GCP_REGION              = var.region
    # Where workshops themselves are built, which is not where this control
    # plane runs — see var.workshop_region. An empty GCP_GKE_ZONES means "use
    # the runner's list for that region"; it treats blank as unset.
    GCP_WORKSHOP_REGION = var.workshop_region
    GCP_GKE_ZONES       = var.gke_zones
    # The shared long-lived project no-cloud runs grant attendees access to.
    GCP_SANDBOX_PROJECT_ID       = google_project.sandbox.project_id
    GOOGLE_WORKSPACE_DOMAIN      = var.workspace_domain
    GOOGLE_WORKSPACE_ADMIN_EMAIL = var.workspace_admin_email
    GOOGLE_WORKSPACE_PARENT_OU   = var.workspace_parent_ou
    HARNESS_ACCOUNT_ID           = var.harness_account_id
    HARNESS_BASE_URL             = var.harness_base_url
    # Azure (optional; empty when unused). AZURE_* are read by the runner's
    # azureCfg; ARM_* authenticate the azurerm/azuread providers. Tenant and
    # subscription appear under both prefixes because those two consumers look
    # for different names.
    AZURE_SUBSCRIPTION_ID = var.azure_subscription_id
    AZURE_TENANT_ID       = var.azure_tenant_id
    AZURE_LOCATION        = var.azure_location
    ARM_SUBSCRIPTION_ID   = var.azure_subscription_id
    ARM_TENANT_ID         = var.azure_tenant_id
    ARM_CLIENT_ID         = var.azure_client_id
    # AWS (optional; empty when unused). The aws provider also reads the access
    # key from the secret env below. The email domain is coalesced to the
    # Workspace domain because an empty AWS_ACCOUNT_EMAIL_DOMAIN would suppress
    # the runner's fallback (an empty string is "set", not unset).
    AWS_REGION               = var.aws_region
    AWS_PARENT_OU_ID         = var.aws_parent_ou_id
    AWS_ACCOUNT_EMAIL_DOMAIN = var.aws_account_email_domain != "" ? var.aws_account_email_domain : var.workspace_domain
  }

  # Every job reads the DB URL and the Harness key the same way. The Azure and
  # AWS credentials are added only when configured, so a deployment not using a
  # given cloud creates no empty secret for it.
  # Gated on non-sensitive vars (subscription id / access key id) so this map
  # stays non-sensitive and can drive the dynamic env block's for_each.
  runner_secret_env = merge(
    {
      DATABASE_URL    = "database-url"
      HARNESS_API_KEY = "harness-api-key"
    },
    var.azure_subscription_id != "" ? { ARM_CLIENT_SECRET = "azure-client-secret" } : {},
    var.aws_access_key_id != "" ? {
      AWS_ACCESS_KEY_ID     = "aws-access-key-id"
      AWS_SECRET_ACCESS_KEY = "aws-secret-access-key"
    } : {},
  )

  cloudsql_connection = google_sql_database_instance.main.connection_name
}

# tf-runner: provisions one workshop run (project -> billing -> APIs -> apply).
resource "google_cloud_run_v2_job" "runner" {
  name                = "tf-runner"
  location            = var.region
  project             = var.admin_project_id
  deletion_protection = false

  # See the matching note in app.tf: the running tag is owned by the deployer
  # (CD trigger or `make deploy`), not by Terraform.
  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image]
  }

  template {
    template {
      service_account = google_service_account.runner.email
      timeout         = "3600s"
      max_retries     = 0

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [local.cloudsql_connection]
        }
      }

      containers {
        image = var.runner_image
        args  = ["run"]

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }

        dynamic "env" {
          for_each = local.runner_env
          content {
            name  = env.key
            value = env.value
          }
        }

        dynamic "env" {
          for_each = local.runner_secret_env
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.s[env.value].secret_id
                version = "latest"
              }
            }
          }
        }

        # Cloud Run's container filesystem is in-memory, so everything
        # `tofu init` unpacks is charged to this limit before a provider even
        # starts: the AWS provider binary alone is 675 MiB, which OOM-killed
        # the plugin at 1Gi (the failure reads as a bogus "plugin handshake"
        # error). The image now ships a pre-populated provider cache, so the
        # binaries are read from the read-only image layer rather than written
        # into memory — this headroom covers the provider processes themselves,
        # with room for the largest (AWS) plus tofu and node.
        resources {
          limits = {
            cpu    = "2"
            memory = "4Gi"
          }
        }
      }
    }
  }

  # Cloud Run revalidates every secret ref when the job is updated, and a
  # reference to the secret container alone doesn't imply its version or the
  # accessor grant. Turning on a cloud creates all three in one apply, so
  # without this the job races ahead of them and the update fails with
  # SecretsAccessCheckFailed.
  depends_on = [
    google_project_service.admin,
    google_secret_manager_secret_version.v,
    google_secret_manager_secret_iam_member.runner,
  ]
}

# tf-reaper: destroys runs past their TTL (terraform destroy + project delete).
resource "google_cloud_run_v2_job" "reaper" {
  name                = "tf-reaper"
  location            = var.region
  project             = var.admin_project_id
  deletion_protection = false

  # See the matching note in app.tf: the running tag is owned by the deployer
  # (CD trigger or `make deploy`), not by Terraform.
  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image]
  }

  template {
    template {
      service_account = google_service_account.runner.email
      timeout         = "1800s"
      max_retries     = 0

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [local.cloudsql_connection]
        }
      }

      containers {
        image = var.runner_image
        args  = ["reap"]

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }

        dynamic "env" {
          for_each = local.runner_env
          content {
            name  = env.key
            value = env.value
          }
        }

        dynamic "env" {
          for_each = local.runner_secret_env
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.s[env.value].secret_id
                version = "latest"
              }
            }
          }
        }

        # Same sizing as tf-runner above, and for the same reason: destroy
        # loads the same providers apply did.
        resources {
          limits = {
            cpu    = "2"
            memory = "4Gi"
          }
        }
      }
    }
  }

  # Cloud Run revalidates every secret ref when the job is updated, and a
  # reference to the secret container alone doesn't imply its version or the
  # accessor grant. Turning on a cloud creates all three in one apply, so
  # without this the job races ahead of them and the update fails with
  # SecretsAccessCheckFailed.
  depends_on = [
    google_project_service.admin,
    google_secret_manager_secret_version.v,
    google_secret_manager_secret_iam_member.runner,
  ]
}

# The app service triggers workshop runs by executing the tf-runner job WITH a
# RUN_ID container override, which needs run.jobs.runWithOverrides. Plain
# roles/run.invoker lacks it; roles/run.developer (scoped to this job) has it.
resource "google_cloud_run_v2_job_iam_member" "app_runs_runner" {
  name     = google_cloud_run_v2_job.runner.name
  location = var.region
  project  = var.admin_project_id
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.app.email}"
}

# tf-scheduler: on a cron, finds scheduled runs whose start time has arrived and
# triggers a tf-runner execution for each.
resource "google_cloud_run_v2_job" "scheduler" {
  name                = "tf-scheduler"
  location            = var.region
  project             = var.admin_project_id
  deletion_protection = false

  # See the matching note in app.tf: the running tag is owned by the deployer
  # (CD trigger or `make deploy`), not by Terraform.
  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image]
  }

  template {
    template {
      service_account = google_service_account.runner.email
      timeout         = "600s"
      max_retries     = 0

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [local.cloudsql_connection]
        }
      }

      containers {
        image = var.runner_image
        args  = ["provision-due"]

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }

        dynamic "env" {
          for_each = merge(local.runner_env, {
            TF_RUNNER_JOB = google_cloud_run_v2_job.runner.name
          })
          content {
            name  = env.key
            value = env.value
          }
        }

        dynamic "env" {
          for_each = local.runner_secret_env
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.s[env.value].secret_id
                version = "latest"
              }
            }
          }
        }

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }
      }
    }
  }

  # Cloud Run revalidates every secret ref when the job is updated, and a
  # reference to the secret container alone doesn't imply its version or the
  # accessor grant. Turning on a cloud creates all three in one apply, so
  # without this the job races ahead of them and the update fails with
  # SecretsAccessCheckFailed.
  depends_on = [
    google_project_service.admin,
    google_secret_manager_secret_version.v,
    google_secret_manager_secret_iam_member.runner,
  ]
}

# The scheduler (runner-sa) triggers tf-runner with a RUN_ID override.
resource "google_cloud_run_v2_job_iam_member" "runner_runs_runner" {
  name     = google_cloud_run_v2_job.runner.name
  location = var.region
  project  = var.admin_project_id
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.runner.email}"
}
