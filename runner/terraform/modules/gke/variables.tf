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
  description = "Node machine type. e2-standard-4 (4 vCPU / 16 GB, ~3.9 CPU allocatable) fits the org Harness delegate at its default 1-CPU request comfortably alongside GKE's system pods and workshop workload — a 2-vCPU node (e2-standard-2) left too little headroom to schedule it reliably."
  type        = string
  default     = "e2-standard-4"
}

variable "disk_size_gb" {
  description = "Boot disk per node. 30 GB pd-standard keeps cost down versus the 100 GB pd-balanced default."
  type        = number
  default     = 30
}

variable "create_timeout" {
  description = "How long to wait for the cluster/node pool to create before erroring. Bounded well below the provider's 40-minute default so a zone that has silently run out of capacity (GKE keeps retrying node provisioning internally rather than failing) is abandoned quickly — the runner then fails the apply over to another zone instead of hanging. A healthy zonal create finishes in a few minutes, so 10m is comfortable headroom."
  type        = string
  default     = "10m"
}

variable "delete_timeout" {
  description = "How long to wait for the cluster/node pool to delete. Kept modest so re-placing a cluster onto another zone (which destroys the stuck one first) and the reaper's teardown can't hang indefinitely on a wedged zone."
  type        = string
  default     = "15m"
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
