output "gke_clusters" {
  description = "Competitor address -> their cluster's name."
  value       = { for email, m in module.gke : email => m.cluster_name }
}

output "gke_cluster_locations" {
  description = "Competitor address -> the zone their cluster is in."
  value       = { for email, m in module.gke : email => m.cluster_location }
}

# What a scenario's firewall rules need to name and target. Exported so a
# scenario root takes them as input rather than re-deriving the naming scheme —
# a second copy of that scheme is a second thing to keep in step.
output "network_names" {
  description = "Competitor address -> the VPC their cluster is on."
  value       = { for email, m in module.gke : email => m.network_name }
}

output "node_tags" {
  description = "Competitor address -> the network tag on their nodes."
  value       = local.node_tags
}

output "gke_credentials_commands" {
  description = "Competitor address -> the gcloud command that points kubectl at their cluster."
  value = {
    for email, m in module.gke :
    email => join(" ", [
      "gcloud container clusters get-credentials",
      m.cluster_name,
      "--zone", m.cluster_location,
      "--project", var.attendee_projects[email],
    ])
  }
}
