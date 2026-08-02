variable "cluster_name" {
  description = "Cluster name. The runner passes k8s-<event>-<short> (see makeClusterName)."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group the cluster and its node pool live in."
  type        = string
}

variable "location" {
  type = string
}

variable "node_count" {
  description = "Nodes in the default pool. 1 is the cheapest usable cluster."
  type        = number
  default     = 1
}

variable "vm_size" {
  description = "Node VM size. Standard_B2s (2 vCPU / 4 GB, burstable) is the AKS analog of GKE's e2-medium — small but able to run the system pods plus a little workshop workload."
  type        = string
  default     = "Standard_B2s"
}

variable "disk_size_gb" {
  description = "OS disk per node. 32 GB is just above the AKS minimum and keeps cost down."
  type        = number
  default     = 32
}

variable "labels" {
  type    = map(string)
  default = {}
}
