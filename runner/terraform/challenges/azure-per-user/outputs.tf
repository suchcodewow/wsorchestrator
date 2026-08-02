output "azure_resource_groups" {
  value = { for email, rg in azurerm_resource_group.this : email => rg.name }
}
