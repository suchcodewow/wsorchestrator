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

  # Which secrets exist. This drives for_each, so it MUST stay non-sensitive:
  # the conditions gate on non-sensitive vars only (a subscription id, an access
  # key id — the access key id is an identifier, not the secret half). Gating on
  # a sensitive value, or building the map with merge() of a sensitive value,
  # taints the whole collection and Terraform then refuses it as a for_each
  # argument. The optional cloud secrets appear only when that cloud is
  # configured, so no empty Secret Manager version is created.
  secret_ids = concat(
    ["database-url", "auth-secret", "google-oauth-client-id", "google-oauth-client-secret", "harness-api-key"],
    var.azure_subscription_id != "" ? ["azure-client-secret"] : [],
    var.aws_access_key_id != "" ? ["aws-access-key-id", "aws-secret-access-key"] : [],
  )

  # id -> value, holding the (mostly sensitive) payloads. Only ever looked up by
  # key for a secret's data — never used as a for_each argument — so its
  # sensitivity is fine here. Keys for clouds that are off go unreferenced.
  secret_data = {
    "database-url"               = local.database_url
    "auth-secret"                = random_password.auth_secret.result
    "google-oauth-client-id"     = var.google_oauth_client_id
    "google-oauth-client-secret" = var.google_oauth_client_secret
    "harness-api-key"            = var.harness_api_key
    "azure-client-secret"        = var.azure_client_secret
    "aws-access-key-id"          = var.aws_access_key_id
    "aws-secret-access-key"      = var.aws_secret_access_key
  }

  # Secrets the runner/reaper/scheduler jobs read. The app doesn't talk to
  # Harness, Azure, or AWS, and the runner has no use for the OAuth or auth
  # secrets. Same non-sensitive gating as secret_ids.
  runner_secrets = concat(
    ["database-url", "harness-api-key"],
    var.azure_subscription_id != "" ? ["azure-client-secret"] : [],
    var.aws_access_key_id != "" ? ["aws-access-key-id", "aws-secret-access-key"] : [],
  )
}

resource "google_secret_manager_secret" "s" {
  for_each = toset(local.secret_ids)

  secret_id = each.value
  project   = var.admin_project_id

  replication {
    auto {}
  }

  depends_on = [google_project_service.admin]
}

resource "google_secret_manager_secret_version" "v" {
  for_each = toset(local.secret_ids)

  secret      = google_secret_manager_secret.s[each.key].id
  secret_data = local.secret_data[each.key]
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
