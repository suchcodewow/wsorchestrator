output "sandbox_project_id" {
  value = var.project_id
}

output "sandbox_console_url" {
  value = "https://console.cloud.google.com/home/dashboard?project=${var.project_id}"
}

# The service account behind this run's Harness Google Cloud connector, and its
# credential. `one()` gives null when the module is switched off, which the
# runner reads as "nothing to connect".
output "harness_gcp_service_account" {
  value = one(module.harness_sa[*].email)
}

# Consumed by the runner and then removed from the run's outputs — it is a live
# credential, so it is never stored on the run or rendered on the run page.
output "harness_gcp_key_json" {
  value     = one(module.harness_sa[*].key_json)
  sensitive = true
}

output "gke_cluster_name" {
  value = module.gke.cluster_name
}

output "gke_cluster_location" {
  value = module.gke.cluster_location
}
