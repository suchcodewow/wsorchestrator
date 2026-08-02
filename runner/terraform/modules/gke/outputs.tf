output "cluster_name" {
  value = google_container_cluster.this.name
}

output "cluster_location" {
  value = google_container_cluster.this.location
}
