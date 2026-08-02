output "cluster_name" {
  value = azurerm_kubernetes_cluster.this.name
}

output "cluster_location" {
  value = azurerm_kubernetes_cluster.this.location
}
