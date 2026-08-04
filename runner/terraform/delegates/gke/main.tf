# Install an org-scoped Harness delegate into a workshop's GKE cluster.
#
# Applied by the runner as a separate, best-effort step after the cluster is
# up (see run.ts): its own state, its own apply, so a delegate failure never
# touches the cluster or fails the workshop. The cluster is read back with a
# data source rather than shared state, keeping this fully decoupled from
# whichever root (gcp-base or gcp-sandbox) created it.
provider "google" {
  project = var.project_id
  region  = var.region
}

data "google_container_cluster" "this" {
  name     = var.cluster_name
  location = var.location
  project  = var.project_id
}

# The runner's own credentials (ADC). It created the cluster, so it can reach
# the API server; installing the delegate needs cluster-admin, which the
# runner's project-level container admin maps to via GKE's IAM→RBAC.
data "google_client_config" "current" {}

provider "helm" {
  kubernetes {
    host                   = "https://${data.google_container_cluster.this.endpoint}"
    cluster_ca_certificate = base64decode(data.google_container_cluster.this.master_auth[0].cluster_ca_certificate)
    token                  = data.google_client_config.current.access_token
  }
}

module "delegate" {
  source = "../../modules/harness-delegate"

  delegate_name    = var.delegate_name
  delegate_token   = var.delegate_token
  account_id       = var.account_id
  manager_endpoint = var.manager_endpoint
  delegate_image   = var.delegate_image
}
