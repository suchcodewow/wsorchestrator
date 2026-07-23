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

  secret_values = {
    "database-url"               = local.database_url
    "auth-secret"                = random_password.auth_secret.result
    "google-oauth-client-id"     = var.google_oauth_client_id
    "google-oauth-client-secret" = var.google_oauth_client_secret
  }
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

resource "google_secret_manager_secret_iam_member" "runner_db" {
  secret_id = google_secret_manager_secret.s["database-url"].secret_id
  project   = var.admin_project_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runner.email}"
}
