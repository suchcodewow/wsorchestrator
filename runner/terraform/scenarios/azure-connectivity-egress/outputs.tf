# Namespaced by scenario id — see the note in gcp-connectivity-egress/outputs.tf.
output "scenario_azure_connectivity_egress_nsgs" {
  description = "Competitor address -> the NSG standing between their nodes and the internet."
  value = {
    for email, g in azurerm_network_security_group.this : email => g.name
  }
}
