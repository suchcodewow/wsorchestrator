# A Kubernetes cluster in every competitor's own project, for a challenge whose
# scenarios need one to break.
#
# A bare challenge builds no cluster — standing one up is the challenge. This
# layer only exists once a scenario says otherwise (`requiresCluster` in its
# scenario.json), and it is applied separately from challenges/gcp-per-user, on
# its own state prefix, for three reasons:
#
#   * the container API has to be enabled and propagated by the projects layer
#     before a cluster can be created in one;
#   * growing a challenge re-applies the projects layer, and that must not
#     re-plan the clusters competitors are working in;
#   * the reaper has to destroy the clusters before the projects that contain
#     them, or deleting the projects strands this layer's state.
#
# Every competitor is one `for_each` key, so a single apply builds all of their
# clusters concurrently rather than one after another.
provider "google" {
  region = var.region
}

locals {
  # The cluster carries the competitor's own project id, which already holds a
  # per-address hash (see makeChallengeProjectId), so two competitors' clusters
  # and node tags can never collide.
  cluster_names = {
    for email, project in var.attendee_projects :
    email => "${var.cluster_prefix}-${project}"
  }

  node_tags = {
    for email, project in var.attendee_projects :
    email => "${var.cluster_prefix}-${project}-node"
  }
}

module "gke" {
  source   = "../../modules/gke"
  for_each = var.attendee_projects

  project_id   = each.value
  cluster_name = local.cluster_names[each.key]
  region       = var.region
  zone_letter  = var.zone_letter
  labels       = var.labels

  # One tag per competitor: a scenario's firewall rules target this, so a rule
  # written for one competitor cannot reach another's nodes.
  node_tags = [local.node_tags[each.key]]

  # Both are inert until a scenario acts on them, and both are set here rather
  # than by the scenario because they are properties of the cluster and its
  # subnet — a scenario that had to change them would be re-planning the
  # cluster, which is precisely what these separate layers avoid.
  private_google_access       = true
  enable_binary_authorization = true
}
