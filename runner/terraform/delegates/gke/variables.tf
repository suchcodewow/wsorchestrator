variable "region" {
  description = "Region the GKE cluster lives in (for the google provider)."
  type        = string
}

variable "project_id" {
  description = "Project the cluster is in — the per-run project for a GCP workshop, or the shared sandbox project for a no-cloud run."
  type        = string
}

variable "cluster_name" {
  description = "The GKE cluster to install the delegate into (makeClusterName)."
  type        = string
}

variable "location" {
  description = "The cluster's zonal location, e.g. us-central1-a (from the cluster's gke_cluster_location output)."
  type        = string
}

variable "account_id" {
  description = "Harness account id."
  type        = string
}

variable "delegate_token" {
  description = "Org-scoped Harness delegate token."
  type        = string
  sensitive   = true
}

variable "manager_endpoint" {
  description = "Harness manager URL the delegate connects to."
  type        = string
}

variable "delegate_name" {
  description = "Delegate/release name, unique within the org."
  type        = string
}

variable "delegate_image" {
  description = "Optional delegate image override; empty uses the chart default."
  type        = string
  default     = ""
}
