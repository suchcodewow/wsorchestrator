# Scenario outputs are merged into the run's outputs alongside every other
# layer's, so they are namespaced by scenario id to keep two scenarios from
# colliding on a common name.
output "scenario_gcp_connectivity_egress_rules" {
  description = "Competitor address -> the deny rule blocking their nodes' egress."
  value = {
    for email, f in google_compute_firewall.deny_internet_egress :
    email => f.name
  }
}
