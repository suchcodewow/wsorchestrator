# The service principal Harness builds the workshop's Azure environment with —
# the Azure half of modules/harness-sa.
#
# One per run: an app registration of its own, rather than the orchestrator's
# own credentials. The orchestrator's principal creates Entra users across the
# tenant, so handing it to a room of attendees would hand them the tenant; this
# one can do exactly what the workshop's resource group allows and dies with it.
data "azuread_client_config" "current" {}

resource "azuread_application" "this" {
  display_name = var.name
  description  = "Workshop Orchestrator: credentials for the event's Harness Azure connector."
}

resource "azuread_service_principal" "this" {
  client_id = azuread_application.this.client_id
  # Nothing signs in interactively as this; it is a machine credential.
  description = "Workshop Orchestrator: Harness Azure connector."
}

# The client secret. Held in state (like the attendee passwords), which is how a
# retried or grown run re-uploads the same secret instead of minting a new one
# and leaving the last one behind in Harness.
resource "azuread_application_password" "this" {
  application_id = azuread_application.this.id
  display_name   = "harness-connector"
}

# Administrator of the workshop's resource group, which is what the labs need:
# pipelines create and destroy real infrastructure in it, not just read it. The
# resource group is the per-run isolation boundary, so this grants nothing
# anywhere else in the subscription.
resource "azurerm_role_assignment" "this" {
  scope                = var.scope
  role_definition_name = var.role
  principal_id         = azuread_service_principal.this.object_id
}
