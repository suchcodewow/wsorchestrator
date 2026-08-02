output "gcp_project_id" {
  value = module.project.project_id
}

output "gcp_console_url" {
  value = "https://console.cloud.google.com/home/dashboard?project=${module.project.project_id}"
}

output "gke_cluster_name" {
  value = module.gke.cluster_name
}

output "gke_cluster_location" {
  value = module.gke.cluster_location
}
