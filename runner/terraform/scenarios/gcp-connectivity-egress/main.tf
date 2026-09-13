# Connectivity: Egress — the competitor's cluster nodes cannot reach the
# internet.
#
# Ported from ../workshop/addons/firewall.tf. Three egress rules per competitor,
# scoped to that competitor's node tag so one competitor's environment is never
# affected by another's. Lower `priority` wins, so the two narrow allows override
# the broad deny:
#
#   allow  900  RFC1918                 nodes <-> pods <-> services, metadata
#   allow  900  199.36.153.4/30 :443    Google APIs via the restricted VIP
#   deny  1000  0.0.0.0/0               everything else
#
# What the competitor sees: pods stuck in ImagePullBackOff pulling from Docker
# Hub or quay.io, and a Harness delegate that installs but never registers.
# Google APIs keep working because the cluster layer turned on Private Google
# Access — without that, cutting egress would also cut the nodes off from the
# control plane and the cluster would simply be broken rather than instructive.
#
# Deliberately no allowance for Harness: reaching it is the thing the competitor
# has to earn.
provider "google" {
  region = var.region
}

resource "google_compute_firewall" "deny_internet_egress" {
  for_each = var.attendee_projects

  project     = each.value
  name        = "${var.node_tags[each.key]}-deny-egress"
  network     = var.network_names[each.key]
  description = "Challenge scenario ${var.scenario_id}: nodes have no route off the VPC."
  direction   = "EGRESS"
  priority    = 1000

  deny {
    protocol = "all"
  }

  destination_ranges = ["0.0.0.0/0"]
  target_tags        = [var.node_tags[each.key]]
}

resource "google_compute_firewall" "allow_internal_egress" {
  for_each = var.attendee_projects

  project     = each.value
  name        = "${var.node_tags[each.key]}-allow-internal-egress"
  network     = var.network_names[each.key]
  description = "Challenge scenario ${var.scenario_id}: keeps the cluster talking to itself."
  direction   = "EGRESS"
  priority    = 900

  allow {
    protocol = "all"
  }

  destination_ranges = [
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
  ]
  target_tags = [var.node_tags[each.key]]
}

resource "google_compute_firewall" "allow_google_apis_egress" {
  for_each = var.attendee_projects

  project     = each.value
  name        = "${var.node_tags[each.key]}-allow-google-apis-egress"
  network     = var.network_names[each.key]
  description = "Challenge scenario ${var.scenario_id}: Google APIs over the restricted VIP, so the nodes keep reaching the control plane."
  direction   = "EGRESS"
  priority    = 900

  allow {
    protocol = "tcp"
    ports    = ["443"]
  }

  destination_ranges = [
    "199.36.153.4/30", # restricted.googleapis.com
    "199.36.153.8/30", # private.googleapis.com
  ]
  target_tags = [var.node_tags[each.key]]
}
