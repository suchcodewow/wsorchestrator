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
  description = "Node instance type. t3.xlarge (4 vCPU / 16 GB) is the EKS analog of GKE's e2-standard-4 — sized so the org Harness delegate at its default 1-CPU request fits alongside the system pods and workshop workload. A 2-vCPU node (t3.large) left too little headroom to schedule it reliably."
  type        = string
  default     = "t3.xlarge"
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

variable "az_count" {
  description = "Availability zones the public subnets are spread over. EKS requires at least two. Fixed rather than derived from the zone lookup so the subnet count stays known at plan time even when that lookup is deferred to apply."
  type        = number
  default     = 2
}
