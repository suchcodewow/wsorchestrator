# Connectivity: Binary Auth — only the competitor's own images are admitted.
#
# Ported from ../workshop/addons/binauthz.tf. The policy is a per-project
# singleton, and a challenge gives every competitor their own project, so each
# gets an independent policy with no `for_each` collision to worry about.
#
# What the competitor sees is a different failure from the egress scenario, and
# that is the point of having both: the image is never pulled at all, and the
# pod's event says it was denied by the attestation policy rather than that the
# registry was unreachable. Run both and one masks the other until the first is
# fixed.
#
# The cluster layer already set evaluation_mode = PROJECT_SINGLETON_POLICY_ENFORCE
# on every challenge cluster. That is inert while the project has no policy of
# its own — GCP's default admits everything — so this resource is what gives it
# teeth, and destroying it (unchecking the scenario) returns the project to the
# permissive default without touching the cluster.
provider "google" {
  region = var.region
}

resource "google_binary_authorization_policy" "policy" {
  for_each = var.attendee_projects

  project = each.value

  description = "Challenge scenario ${var.scenario_id}: only this competitor's own registries are admitted."

  # Exempt Google's own GKE system images, or kube-system goes down with
  # everything else and the cluster is broken rather than instructive.
  global_policy_evaluation_mode = "ENABLE"

  dynamic "admission_whitelist_patterns" {
    for_each = [
      "${var.region}-docker.pkg.dev/${each.value}/*", # Artifact Registry
      "gcr.io/${each.value}/*",                       # legacy Container Registry
    ]
    content {
      name_pattern = admission_whitelist_patterns.value
    }
  }

  default_admission_rule {
    evaluation_mode  = "ALWAYS_DENY"
    enforcement_mode = "ENFORCED_BLOCK_AND_AUDIT_LOG"
  }
}
