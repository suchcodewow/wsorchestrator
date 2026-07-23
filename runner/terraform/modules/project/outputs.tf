output "project_id" {
  value = google_project.this.project_id
}

# Depend on this to ensure APIs are active before creating resources.
output "enabled_services" {
  value = [for s in google_project_service.apis : s.id]
}
