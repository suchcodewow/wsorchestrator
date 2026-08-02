variable "project_id" {
  description = "Project the cluster is created in."
  type        = string
}

variable "cluster_name" {
  description = "Cluster name. The runner passes k8s-<event>-<short> (see makeClusterName)."
  type        = string
}

variable "region" {
  description = "Region. The cluster is created zonal in <region>-<zone_letter> — a zonal control plane is the cheapest (a regional cluster triples both control plane and node count)."
  type        = string
}

variable "zone_letter" {
  description = "Which zone of the region hosts the zonal cluster."
  type        = string
  default     = "a"
}

variable "node_count" {
  description = "Nodes in the single pool. 1 is the cheapest usable cluster."
  type        = number
  default     = 1
}

variable "machine_type" {
  description = "Node machine type. e2-medium (2 vCPU / 4 GB) is the smallest that comfortably runs GKE's system pods plus a little workshop workload."
  type        = string
  default     = "e2-medium"
}

variable "disk_size_gb" {
  description = "Boot disk per node. 30 GB pd-standard keeps cost down versus the 100 GB pd-balanced default."
  type        = number
  default     = 30
}

variable "use_spot" {
  description = "Spot nodes are ~60-90% cheaper but can be preempted mid-workshop, so they default off — a workshop cluster must not disappear under attendees. Enable only for throwaway testing."
  type        = bool
  default     = false
}

variable "labels" {
  type    = map(string)
  default = {}
}
