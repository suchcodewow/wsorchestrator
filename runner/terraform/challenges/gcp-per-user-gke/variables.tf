variable "attendee_projects" {
  description = <<-EOT
    Competitor address -> the GCP project id their cluster goes in. The same map
    challenges/gcp-per-user was applied with, recomputed by the runner from the
    roster (challengeProjectMap) rather than passed between layers, so growing a
    challenge adds a key and leaves the existing clusters untouched in state.
  EOT
  type        = map(string)
  default     = {}
}

variable "cluster_prefix" {
  description = "Leading part of each cluster's name; the competitor's project id supplies the unique remainder."
  type        = string
  default     = "k8s"
}

variable "region" {
  type    = string
  default = "us-west1"
}

variable "zone_letter" {
  description = "Which zone of the region the zonal clusters go in. The runner rewrites this and re-applies when a zone turns out to be out of capacity (applyGkeWithZoneFailover)."
  type        = string
  default     = "a"
}

variable "labels" {
  type    = map(string)
  default = {}
}

# Passed by the runner but not consumed directly; declared to avoid warnings.
variable "run_id" {
  type    = string
  default = ""
}
