# An AKS cluster in every competitor's own resource group, for a challenge whose
# scenarios need one to break. The Azure mirror of
# challenges/gcp-per-user-gke, and applied the same way: one apply covering
# every competitor, so their clusters are built concurrently.
#
# Unlike AWS — where each competitor owns a separate member account and so needs
# a separate assumed-role provider — every resource group here is in the one
# subscription, so a single provider reaches all of them.
#
# Each competitor gets a vnet and subnet of their own rather than the
# AKS-managed network a workshop uses. A scenario has to be able to attach an
# NSG or a route table to the node subnet, and a subnet inside the AKS-managed
# node resource group cannot be touched.
provider "azurerm" {
  subscription_id = var.subscription_id
  features {}
}

locals {
  # The resource group name already carries a per-address hash (see
  # makeChallengeResourceGroup), so names derived from it cannot collide.
  cluster_names = {
    for email, rg in var.attendee_resource_groups :
    email => "${var.cluster_prefix}-${rg}"
  }
}

resource "azurerm_virtual_network" "this" {
  for_each = var.attendee_resource_groups

  name                = "${each.value}-vnet"
  resource_group_name = each.value
  location            = var.location
  address_space       = [var.vnet_cidr]
  tags                = var.labels
}

resource "azurerm_subnet" "nodes" {
  for_each = var.attendee_resource_groups

  name                 = "${each.value}-nodes"
  resource_group_name  = each.value
  virtual_network_name = azurerm_virtual_network.this[each.key].name
  address_prefixes     = [var.subnet_cidr]
}

module "aks" {
  source   = "../../modules/aks"
  for_each = var.attendee_resource_groups

  cluster_name        = local.cluster_names[each.key]
  resource_group_name = each.value
  location            = var.location
  labels              = var.labels

  vnet_subnet_id = azurerm_subnet.nodes[each.key].id
}
