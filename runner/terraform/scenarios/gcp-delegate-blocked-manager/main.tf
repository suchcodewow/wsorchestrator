# Delegate: Blocked Manager — the cluster works, the delegate starts, and it
# cannot reach Harness.
#
# This is the shape a locked-down enterprise GKE cluster actually has, and the
# difference from gcp-connectivity-egress is the whole point of it existing.
# That scenario denies everything, so the delegate image — which lives on Google
# Artifact Registry at us-docker.pkg.dev — never pulls, and a pod that never
# starts writes no logs. Here the private DNS zones below route *.pkg.dev and
# *.googleapis.com to the restricted VIP, which the firewall allows: images pull,
# the nodes talk to the control plane, the cluster is genuinely healthy.
#
# Everything else is denied, app.harness.io included. So a competitor installs
# the delegate, watches the pod come up, and finds this in its log:
#
#   ERROR ... Failed to connect to https://app.harness.io ... connect timed out
#
# The fix is to allow egress to Harness. Nothing here hints at that, and nothing
# here allowlists it — earning that connection is the challenge.
#
# Private Google Access is already on each competitor's subnet (the cluster
# layer sets it), which is what makes the restricted VIP routable at all.
provider "google" {
  region = var.region
}

locals {
  # The VIP ranges Private Google Access serves. `restricted` excludes the
  # Google APIs that can exfiltrate data, which is why an enterprise picks it.
  restricted_vip_cidrs = ["199.36.153.4/30", "199.36.153.8/30"]

  # Every zone each competitor needs for the cluster to work and for images to
  # pull, pointed at the restricted VIP. Without these the names resolve to
  # public Google addresses, the deny rule below catches them, and the cluster
  # breaks instead of being interestingly broken.
  private_zones = {
    "googleapis" = "googleapis.com."
    "pkg-dev"    = "pkg.dev."
    "gcr-io"     = "gcr.io."
  }

  # One entry per competitor per zone, since a private zone is per-network.
  zone_targets = {
    for pair in setproduct(keys(var.attendee_projects), keys(local.private_zones)) :
    "${pair[0]}|${pair[1]}" => {
      email = pair[0]
      zone  = pair[1]
      dns   = local.private_zones[pair[1]]
    }
  }
}

resource "google_dns_managed_zone" "private" {
  for_each = local.zone_targets

  project     = var.attendee_projects[each.value.email]
  name        = "${var.node_tags[each.value.email]}-${each.value.zone}"
  dns_name    = each.value.dns
  description = "Challenge scenario ${var.scenario_id}: routes ${each.value.dns} to the restricted VIP."
  visibility  = "private"

  private_visibility_config {
    networks {
      network_url = "projects/${var.attendee_projects[each.value.email]}/global/networks/${var.network_names[each.value.email]}"
    }
  }

  labels = var.labels
}

# The apex answers with the VIP addresses themselves...
resource "google_dns_record_set" "apex" {
  for_each = local.zone_targets

  project      = var.attendee_projects[each.value.email]
  managed_zone = google_dns_managed_zone.private[each.key].name
  name         = each.value.dns
  type         = "A"
  ttl          = 300
  rrdatas      = ["199.36.153.4", "199.36.153.5", "199.36.153.6", "199.36.153.7"]
}

# ...and everything under it is a CNAME to the apex, which is the documented
# way to make an entire Google domain resolve to the restricted VIP.
resource "google_dns_record_set" "wildcard" {
  for_each = local.zone_targets

  project      = var.attendee_projects[each.value.email]
  managed_zone = google_dns_managed_zone.private[each.key].name
  name         = "*.${each.value.dns}"
  type         = "CNAME"
  ttl          = 300
  rrdatas      = [each.value.dns]
}

# --- The firewall: Google reachable, nothing else ---

resource "google_compute_firewall" "allow_internal_egress" {
  for_each = var.attendee_projects

  project     = each.value
  name        = "${var.node_tags[each.key]}-dm-allow-internal"
  network     = var.network_names[each.key]
  description = "Challenge scenario ${var.scenario_id}: keeps the cluster talking to itself."
  direction   = "EGRESS"
  priority    = 900

  allow {
    protocol = "all"
  }

  destination_ranges = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
  target_tags        = [var.node_tags[each.key]]
}

resource "google_compute_firewall" "allow_google_apis_egress" {
  for_each = var.attendee_projects

  project     = each.value
  name        = "${var.node_tags[each.key]}-dm-allow-google"
  network     = var.network_names[each.key]
  description = "Challenge scenario ${var.scenario_id}: Google APIs and Artifact Registry over the restricted VIP, so images pull and the cluster stays healthy."
  direction   = "EGRESS"
  priority    = 900

  allow {
    protocol = "tcp"
    ports    = ["443"]
  }

  destination_ranges = local.restricted_vip_cidrs
  target_tags        = [var.node_tags[each.key]]
}

resource "google_compute_firewall" "deny_internet_egress" {
  for_each = var.attendee_projects

  project     = each.value
  name        = "${var.node_tags[each.key]}-dm-deny-egress"
  network     = var.network_names[each.key]
  description = "Challenge scenario ${var.scenario_id}: everything else, app.harness.io included."
  direction   = "EGRESS"
  priority    = 1000

  deny {
    protocol = "all"
  }

  destination_ranges = ["0.0.0.0/0"]
  target_tags        = [var.node_tags[each.key]]
}
