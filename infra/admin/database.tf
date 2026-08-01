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
    edition           = "ENTERPRISE"
    availability_type = "ZONAL"

    ip_configuration {
      # No public authorized networks; reach it via the Cloud SQL
      # connector socket (Cloud Run) or cloud-sql-proxy (local dev).
      ipv4_enabled = true
    }

    /*
     * Daily automated backups, plus point-in-time recovery.
     *
     * These were off. Nothing on this instance was recoverable — a mistaken
     * delete, a bad migration, or a dropped table had no answer but retyping
     * the content.
     *
     * `start_time` is UTC and deliberately in the small hours: a backup takes
     * a consistent snapshot, and the quiet window is the one where a workshop
     * is least likely to be mid-provision when it happens.
     *
     * Point-in-time recovery is the more useful half. An automated backup can
     * only take you back to 03:00; PITR replays the write-ahead log, so a
     * table dropped at 14:32 can be recovered to 14:31. It costs WAL storage
     * for the retention window, which at this instance's size is negligible.
     */
    backup_configuration {
      enabled                        = true
      start_time                     = var.db_backup_start_time
      location                       = var.region
      point_in_time_recovery_enabled = true
      # Days of write-ahead log kept for PITR.
      transaction_log_retention_days = var.db_backup_retention_days

      backup_retention_settings {
        retained_backups = var.db_backup_retention_days
        retention_unit   = "COUNT"
      }
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
