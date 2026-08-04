# Install an org-scoped Harness delegate into a workshop's AKS cluster.
#
# The Azure mirror of delegates/gke: a separate, best-effort apply the runner
# does after the cluster is up. The cluster is read back with a data source;
# AKS keeps local accounts enabled (the module leaves the default on), so its
# admin kube_config authenticates the Helm install.
provider "azurerm" {
  subscription_id = var.subscription_id
  features {}
}

data "azurerm_kubernetes_cluster" "this" {
  name                = var.cluster_name
  resource_group_name = var.resource_group_name
}

provider "helm" {
  kubernetes {
    host                   = data.azurerm_kubernetes_cluster.this.kube_config[0].host
    client_certificate     = base64decode(data.azurerm_kubernetes_cluster.this.kube_config[0].client_certificate)
    client_key             = base64decode(data.azurerm_kubernetes_cluster.this.kube_config[0].client_key)
    cluster_ca_certificate = base64decode(data.azurerm_kubernetes_cluster.this.kube_config[0].cluster_ca_certificate)
  }
}

module "delegate" {
  source = "../../modules/harness-delegate"

  delegate_name    = var.delegate_name
  delegate_token   = var.delegate_token
  account_id       = var.account_id
  manager_endpoint = var.manager_endpoint
  delegate_image   = var.delegate_image
}
