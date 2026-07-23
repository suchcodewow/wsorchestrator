resource "random_password" "db" {
  length  = 24
  special = false
}

resource "google_sql_database_instance" "main" {
  name             = "workshops-db"
  project          = var.admin_project_id
  region           = var.region
  database_version = "POSTGRES_16"

  # Testing posture — flip on for anything real.
  deletion_protection = false

  settings {
    tier              = var.db_tier
    availability_type = "ZONAL"

    ip_configuration {
      # No public authorized networks; reach it via the Cloud SQL
      # connector socket (Cloud Run) or cloud-sql-proxy (local dev).
      ipv4_enabled = true
    }

    backup_configuration {
      enabled = false
    }
  }

  depends_on = [google_project_service.admin]
}

resource "google_sql_database" "app" {
  name     = "workshops"
  instance = google_sql_database_instance.main.name
  project  = var.admin_project_id
}

resource "google_sql_user" "app" {
  name     = "appuser"
  instance = google_sql_database_instance.main.name
  password = random_password.db.result
  project  = var.admin_project_id
}
