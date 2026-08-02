# A challenge's Azure environment: one resource group per competitor, each
# solely owned by the competitor it belongs to. No AKS cluster — building the
# cluster from scratch is part of the challenge (mirrors challenges/gcp-per-user,
# which likewise creates only the project, never a cluster).
provider "azurerm" {
  subscription_id = var.subscription_id
  features {}
}

provider "azuread" {
  tenant_id = var.tenant_id
}

resource "azurerm_resource_group" "this" {
  for_each = var.attendee_resource_groups

  name     = each.value
  location = var.location
  tags     = var.labels
}

# for_each over the (non-sensitive) resource-group map, whose keys are the
# competitor addresses, so the sensitive password map is only ever looked up.
resource "azuread_user" "attendees" {
  for_each = var.attendee_resource_groups

  user_principal_name   = each.key
  mail_nickname         = split("@", each.key)[0]
  display_name          = split("@", each.key)[0]
  password              = var.attendee_passwords[each.key]
  force_password_change = false
}

resource "azurerm_role_assignment" "attendees" {
  for_each = var.attendee_resource_groups

  scope                = azurerm_resource_group.this[each.key].id
  role_definition_name = var.attendee_role
  principal_id         = azuread_user.attendees[each.key].object_id
}
