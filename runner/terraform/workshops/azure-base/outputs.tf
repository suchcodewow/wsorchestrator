output "azure_resource_group" {
  value = azurerm_resource_group.this.name
}

output "azure_portal_url" {
  value = "https://portal.azure.com/#@${var.tenant_id}/resource${azurerm_resource_group.this.id}"
}

# The app registration behind the event's Harness Azure connector, and its
# client secret. `one()` gives null when the module is switched off, which the
# runner reads as "nothing to connect".
output "harness_azure_application" {
  value = one(module.harness_sp[*].display_name)
}

output "harness_azure_client_id" {
  value = one(module.harness_sp[*].client_id)
}

output "harness_azure_tenant_id" {
  value = one(module.harness_sp[*].tenant_id)
}

# Consumed by the runner and then removed from the run's outputs — it is a live
# credential, so it is never stored on the run or rendered on the run page.
output "harness_azure_client_secret" {
  value     = one(module.harness_sp[*].client_secret)
  sensitive = true
}

output "aks_cluster_name" {
  value = module.aks.cluster_name
}

output "aks_cluster_location" {
  value = module.aks.cluster_location
}
