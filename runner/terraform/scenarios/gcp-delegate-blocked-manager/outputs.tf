# Namespaced by scenario id — see the note in gcp-connectivity-egress/outputs.tf.
output "scenario_gcp_delegate_blocked_manager_rules" {
  description = "Competitor address -> the deny rule standing between their delegate and Harness."
  value = {
    for email, f in google_compute_firewall.deny_internet_egress :
    email => f.name
  }
}
