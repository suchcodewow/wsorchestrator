# A deliberately small, cheap AKS cluster for a workshop — the Azure analog of
# modules/gke. sku_tier = "Free" means no charge for the managed control plane
# (like GKE's free zonal tier), and a single small node keeps the rest
# inexpensive.
#
# The default node pool is on-demand, not Spot: AKS Spot requires a separate
# node pool (the default pool cannot be Spot at all), and a workshop cluster
# must not be evicted out from under attendees mid-session — the same call
# modules/gke makes with use_spot = false.

resource "azurerm_kubernetes_cluster" "this" {
  name                = var.cluster_name
  resource_group_name = var.resource_group_name
  location            = var.location
  dns_prefix          = var.cluster_name
  sku_tier            = "Free"

  default_node_pool {
    name            = "default"
    node_count      = var.node_count
    vm_size         = var.vm_size
    os_disk_size_gb = var.disk_size_gb

    # Empty lets AKS manage its own network, which is what a workshop wants and
    # what this module has always done. A challenge passes a subnet it created,
    # because a scenario has to be able to attach an NSG or a route table to it
    # — and neither is possible on a subnet living in the AKS-managed node
    # resource group.
    vnet_subnet_id = var.vnet_subnet_id != "" ? var.vnet_subnet_id : null
  }

  # A system-assigned managed identity is the simplest control-plane identity
  # and needs no separate service principal to create or clean up.
  identity {
    type = "SystemAssigned"
  }

  tags = var.labels
}
