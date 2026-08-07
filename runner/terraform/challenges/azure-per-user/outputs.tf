output "azure_resource_groups" {
  value = { for email, rg in azurerm_resource_group.this : email => rg.name }
}

# One portal deep link per competitor — the per-user mirror of the single
# `azure_portal_url` workshops/azure-base emits. The attendee page reads this to
# link each competitor straight to the resource group they own.
output "azure_portal_urls" {
  value = {
    for email, rg in azurerm_resource_group.this :
    email => "https://portal.azure.com/#@${var.tenant_id}/resource${rg.id}"
  }
}
