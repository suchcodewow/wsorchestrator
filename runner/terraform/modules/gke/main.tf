# A deliberately small, cheap Kubernetes cluster for a workshop: one zonal
# control plane and a single small node pool. Zonal (not regional) is the
# cheapest option, and the first zonal cluster per billing account is covered by
# GKE's free management tier; a single on-demand e2-medium node runs well under
# a dollar an hour. Nodes are on-demand, not spot: a workshop cluster must not
# be preempted out from under attendees mid-session (see var.use_spot).
#
# The cluster gets its own tiny VPC rather than the project's "default" network.
# New workshop projects may have default-network creation disabled by org
# policy, and a dedicated network means `terraform destroy` (the reaper) removes
# exactly what was created. Everything is named after the cluster, so two
# clusters can coexist in one project (the shared no-cloud sandbox needs this).

locals {
  location = "${var.region}-${var.zone_letter}"
}

resource "google_compute_network" "this" {
  project                 = var.project_id
  name                    = "${var.cluster_name}-net"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "this" {
  project       = var.project_id
  name          = "${var.cluster_name}-subnet"
  region        = var.region
  network       = google_compute_network.this.id
  ip_cidr_range = "10.0.0.0/20"
}

resource "google_container_cluster" "this" {
  project  = var.project_id
  name     = var.cluster_name
  location = local.location

  network    = google_compute_network.this.id
  subnetwork = google_compute_subnetwork.this.id

  # Manage our own node pool so node count/size/spot are under our control; the
  # default pool GKE would otherwise create is not.
  remove_default_node_pool = true
  initial_node_count       = 1

  # VPC-native. Left empty, GKE allocates the pod and service secondary ranges
  # on our subnet automatically.
  ip_allocation_policy {}

  # Without this the provider (google >= 6) refuses to delete the cluster, which
  # would strand the reaper's `terraform destroy`.
  deletion_protection = false

  resource_labels = var.labels
}

resource "google_container_node_pool" "primary" {
  project    = var.project_id
  name       = "default"
  location   = local.location
  cluster    = google_container_cluster.this.name
  node_count = var.node_count

  node_config {
    machine_type = var.machine_type
    disk_size_gb = var.disk_size_gb
    disk_type    = "pd-standard"
    spot         = var.use_spot

    oauth_scopes = ["https://www.googleapis.com/auth/cloud-platform"]
    labels       = var.labels

    metadata = {
      disable-legacy-endpoints = "true"
    }
  }
}
