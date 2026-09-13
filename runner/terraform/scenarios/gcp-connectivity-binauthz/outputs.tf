# Namespaced by scenario id — see the note in gcp-connectivity-egress/outputs.tf.
output "scenario_gcp_connectivity_binauthz_policies" {
  description = "Competitor address -> the project their deny-by-default policy governs."
  value = {
    for email, p in google_binary_authorization_policy.policy :
    email => p.project
  }
}
