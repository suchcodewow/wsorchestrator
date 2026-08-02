output "sandbox_project_id" {
  value = var.project_id
}

output "sandbox_console_url" {
  value = "https://console.cloud.google.com/home/dashboard?project=${var.project_id}"
}

output "gke_cluster_name" {
  value = module.gke.cluster_name
}

output "gke_cluster_location" {
  value = module.gke.cluster_location
}
