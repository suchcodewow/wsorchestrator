output "cluster_name" {
  value = google_container_cluster.this.name
}

output "cluster_location" {
  value = google_container_cluster.this.location
}

# The network the cluster was given. A challenge scenario's firewall rules have
# to name it, and it is derived from the cluster name rather than passed in, so
# reading it back beats every caller recomputing the same string.
output "network_name" {
  value = google_compute_network.this.name
}

output "subnet_name" {
  value = google_compute_subnetwork.this.name
}

# Enough to configure a `kubernetes` provider against this cluster, for a future
# scenario whose issues live inside the cluster rather than in the VPC around
# it. Neither is a credential — the caller still authenticates as itself.
output "endpoint" {
  value = google_container_cluster.this.endpoint
}

output "ca_certificate" {
  value = google_container_cluster.this.master_auth[0].cluster_ca_certificate
}
