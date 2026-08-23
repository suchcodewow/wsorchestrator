# The Azure environment for a workshop: one resource group (the per-run
# isolation boundary), one native Entra user per attendee, Contributor on the
# group for each, and a small AKS cluster. The mirror of workshops/gcp-base.
provider "azurerm" {
  subscription_id = var.subscription_id
  features {}
}

provider "azuread" {
  tenant_id = var.tenant_id
}

resource "azurerm_resource_group" "this" {
  name     = var.resource_group_name
  location = var.location
  tags     = var.labels
}

# One Entra user per attendee, keyed by address. Same username (the UPN) and
# password as their Google account, so a single credential works across clouds.
# force_password_change_next_sign_in stays off: a forced reset would diverge
# from the other clouds' copies of the same password (see the GCP account
# creation in directory.ts, which likewise no longer forces a change).
resource "azuread_user" "attendees" {
  for_each = toset(var.attendee_emails)

  user_principal_name   = each.value
  mail_nickname         = split("@", each.value)[0]
  display_name          = split("@", each.value)[0]
  password              = var.attendee_passwords[each.value]
  force_password_change = false
}

resource "azurerm_role_assignment" "attendees" {
  for_each = azuread_user.attendees

  scope                = azurerm_resource_group.this.id
  role_definition_name = var.attendee_role
  principal_id         = each.value.object_id
}

# The identity the event's Harness Azure connector authenticates as. Its client
# secret leaves here in a sensitive output, which the runner uploads to Harness
# and then drops (see `linkAzureToHarness`). count, so a tenant whose
# orchestrator principal may not create app registrations can turn the whole
# thing off by passing an empty service_principal_name.
module "harness_sp" {
  source = "../../modules/harness-azure-sp"
  count  = var.service_principal_name == "" ? 0 : 1

  name  = var.service_principal_name
  scope = azurerm_resource_group.this.id
  role  = var.service_principal_role
}

module "aks" {
  source              = "../../modules/aks"
  cluster_name        = var.cluster_name
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  labels              = var.labels
}
