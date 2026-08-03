resource "random_password" "auth_secret" {
  length  = 32
  special = false
}

locals {
  # Cloud Run reaches Cloud SQL over the connector unix socket mounted at
  # /cloudsql/<connection_name>. node-postgres reads host= from the query.
  database_url = format(
    "postgresql://%s:%s@localhost/%s?host=/cloudsql/%s",
    google_sql_user.app.name,
    random_password.db.result,
    google_sql_database.app.name,
    google_sql_database_instance.main.connection_name,
  )

  secret_values = merge(
    {
      "database-url"               = local.database_url
      "auth-secret"                = random_password.auth_secret.result
      "google-oauth-client-id"     = var.google_oauth_client_id
      "google-oauth-client-secret" = var.google_oauth_client_secret
      "harness-api-key"            = var.harness_api_key
    },
    # Only created when the cloud is configured — Secret Manager rejects an
    # empty version, and a deployment not using a cloud has no secret to store.
    var.azure_client_secret != ""
    ? { "azure-client-secret" = var.azure_client_secret }
    : {},
    var.aws_access_key_id != "" ? {
      "aws-access-key-id"     = var.aws_access_key_id
      "aws-secret-access-key" = var.aws_secret_access_key
    } : {},
  )

  # Secrets the runner/reaper/scheduler jobs read. The app doesn't talk to
  # Harness, Azure, or AWS, and the runner has no use for the OAuth or auth
  # secrets.
  runner_secrets = concat(
    ["database-url", "harness-api-key"],
    var.azure_client_secret != "" ? ["azure-client-secret"] : [],
    var.aws_access_key_id != "" ? ["aws-access-key-id", "aws-secret-access-key"] : [],
  )
}

resource "google_secret_manager_secret" "s" {
  for_each = local.secret_values

  secret_id = each.key
  project   = var.admin_project_id

  replication {
    auto {}
  }

  depends_on = [google_project_service.admin]
}

resource "google_secret_manager_secret_version" "v" {
  for_each = local.secret_values

  secret      = google_secret_manager_secret.s[each.key].id
  secret_data = each.value
}

# app-sa reads all four secrets; runner-sa only needs the DB URL.
resource "google_secret_manager_secret_iam_member" "app" {
  for_each = google_secret_manager_secret.s

  secret_id = each.value.secret_id
  project   = var.admin_project_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"
}

# This grant used to be a single resource for the DB URL alone. Without this,
# Terraform would destroy and recreate it, briefly dropping the runner's access.
moved {
  from = google_secret_manager_secret_iam_member.runner_db
  to   = google_secret_manager_secret_iam_member.runner["database-url"]
}

resource "google_secret_manager_secret_iam_member" "runner" {
  for_each = toset(local.runner_secrets)

  secret_id = google_secret_manager_secret.s[each.key].secret_id
  project   = var.admin_project_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runner.email}"
}
