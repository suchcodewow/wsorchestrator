output "azure_resource_group" {
  value = azurerm_resource_group.this.name
}

output "azure_portal_url" {
  value = "https://portal.azure.com/#@${var.tenant_id}/resource${azurerm_resource_group.this.id}"
}

output "aks_cluster_name" {
  value = module.aks.cluster_name
}

output "aks_cluster_location" {
  value = module.aks.cluster_location
}
