variable "cluster_name" {
  description = "Cluster name. The runner passes k8s-<event>-<short> (see makeClusterName)."
  type        = string
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "node_count" {
  description = "Nodes in the single managed node group. 1 is the cheapest usable cluster."
  type        = number
  default     = 1
}

variable "instance_type" {
  description = "Node instance type. t3.large (2 vCPU / 8 GB) is the EKS analog of GKE's e2-standard-2 — sized so the org Harness delegate (~1 CPU / 2 GB) fits alongside the system pods and workshop workload."
  type        = string
  default     = "t3.large"
}

variable "disk_size_gb" {
  description = "Node volume size. 20 GB keeps cost down."
  type        = number
  default     = 20
}

variable "labels" {
  description = "Tags applied to every resource."
  type        = map(string)
  default     = {}
}
