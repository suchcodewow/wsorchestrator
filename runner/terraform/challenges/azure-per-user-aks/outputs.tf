output "aks_clusters" {
  description = "Competitor address -> their cluster's name."
  value       = { for email, m in module.aks : email => m.cluster_name }
}

output "aks_cluster_locations" {
  description = "Competitor address -> the region their cluster is in."
  value       = { for email, m in module.aks : email => m.cluster_location }
}

# What a scenario attaches an NSG or a route table to. Exported so a scenario
# root takes it as input rather than re-deriving the naming scheme.
output "subnet_ids" {
  description = "Competitor address -> the node subnet their cluster runs in."
  value       = { for email, s in azurerm_subnet.nodes : email => s.id }
}

output "aks_credentials_commands" {
  description = "Competitor address -> the az command that points kubectl at their cluster."
  value = {
    for email, rg in var.attendee_resource_groups :
    email => join(" ", [
      "az aks get-credentials",
      "--resource-group", rg,
      "--name", local.cluster_names[email],
    ])
  }
}
