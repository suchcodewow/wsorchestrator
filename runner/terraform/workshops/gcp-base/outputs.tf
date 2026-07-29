output "gcp_project_id" {
  value = module.project.project_id
}

output "gcp_console_url" {
  value = "https://console.cloud.google.com/home/dashboard?project=${module.project.project_id}"
}
