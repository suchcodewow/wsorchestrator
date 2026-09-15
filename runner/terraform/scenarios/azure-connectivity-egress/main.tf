# Connectivity: Egress (Azure) — the nodes can reach Azure, and nothing else.
#
# The Azure analog of gcp-connectivity-egress. Where GCP needs private DNS to
# keep Google reachable and AWS needs VPC endpoints, Azure has service tags:
# named, maintained address sets that let an NSG say "Microsoft's container
# registry" without anyone tracking the ranges. That makes this the tidiest of
# the three, and it is exactly how an Azure shop writes the real thing.
#
# The allows are the ones AKS genuinely requires — the registries its system
# images come from, Entra for identity, and Resource Manager for the control
# plane. Then Internet is denied, so pods pulling from Docker Hub or quay.io sit
# in ImagePullBackOff and a Harness delegate never registers. Nothing here
# allowlists Harness.
#
# Roster-shaped rather than perCompetitor: every resource group is in the one
# subscription, so a single provider reaches all of them and Terraform applies
# every competitor's NSG concurrently within one apply.
#
# The subnet this attaches to belongs to the cluster layer, which built it
# precisely so a scenario would have one it owns — an AKS-managed node subnet
# lives in a resource group we do not control and cannot be touched.
provider "azurerm" {
  subscription_id = var.subscription_id
  features {}
}

locals {
  # Service tags AKS needs to stay up. AzureCloud would be simpler and is what a
  # lazy lockdown reaches for, but it allows every Azure endpoint including ones
  # a competitor could tunnel through — these are the narrow set.
  allowed_tags = [
    "AzureContainerRegistry",
    "MicrosoftContainerRegistry",
    "AzureActiveDirectory",
    "AzureResourceManager",
  ]

  # One rule per competitor per tag, each at its own priority below the deny.
  tag_rules = {
    for pair in setproduct(keys(var.attendee_resource_groups), local.allowed_tags) :
    "${pair[0]}|${pair[1]}" => {
      email = pair[0]
      tag   = pair[1]
      # Priorities must be unique within an NSG and lower wins; the deny sits at
      # 4000, well above anything indexed here.
      rank = index(local.allowed_tags, pair[1])
    }
  }
}

resource "azurerm_network_security_group" "this" {
  for_each = var.attendee_resource_groups

  name                = "${each.value}-egress"
  resource_group_name = each.value
  location            = var.location
  tags                = var.labels
}

resource "azurerm_network_security_rule" "allow_azure" {
  for_each = local.tag_rules

  name                        = "allow-${lower(each.value.tag)}"
  resource_group_name         = var.attendee_resource_groups[each.value.email]
  network_security_group_name = azurerm_network_security_group.this[each.value.email].name

  priority                   = 100 + each.value.rank
  direction                  = "Outbound"
  access                     = "Allow"
  protocol                   = "*"
  source_port_range          = "*"
  destination_port_range     = "*"
  source_address_prefix      = "*"
  destination_address_prefix = each.value.tag
}

# The cluster also has to talk to itself, and VirtualNetwork is the tag for that.
resource "azurerm_network_security_rule" "allow_vnet" {
  for_each = var.attendee_resource_groups

  name                        = "allow-vnet"
  resource_group_name         = each.value
  network_security_group_name = azurerm_network_security_group.this[each.key].name

  priority                   = 200
  direction                  = "Outbound"
  access                     = "Allow"
  protocol                   = "*"
  source_port_range          = "*"
  destination_port_range     = "*"
  source_address_prefix      = "*"
  destination_address_prefix = "VirtualNetwork"
}

resource "azurerm_network_security_rule" "deny_internet" {
  for_each = var.attendee_resource_groups

  name                        = "deny-internet"
  resource_group_name         = each.value
  network_security_group_name = azurerm_network_security_group.this[each.key].name

  description                = "Challenge scenario ${var.scenario_id}: everything else, app.harness.io included."
  priority                   = 4000
  direction                  = "Outbound"
  access                     = "Deny"
  protocol                   = "*"
  source_port_range          = "*"
  destination_port_range     = "*"
  source_address_prefix      = "*"
  destination_address_prefix = "Internet"
}

resource "azurerm_subnet_network_security_group_association" "this" {
  for_each = var.attendee_resource_groups

  subnet_id                 = var.subnet_ids[each.key]
  network_security_group_id = azurerm_network_security_group.this[each.key].id

  # The rules exist before the NSG is attached, so the subnet is never briefly
  # governed by an empty (deny-nothing, then deny-everything) group.
  depends_on = [
    azurerm_network_security_rule.allow_azure,
    azurerm_network_security_rule.allow_vnet,
    azurerm_network_security_rule.deny_internet,
  ]
}
