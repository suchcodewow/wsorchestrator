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
  description = "Node VM size. Standard_B4ms (4 vCPU / 16 GB, burstable) is the AKS analog of GKE's e2-standard-4 — sized so the org Harness delegate at its default 1-CPU request fits alongside AKS's (heavier) system pods and workshop workload. A 2-vCPU node (Standard_B2ms) could not schedule it reliably."
  type        = string
  default     = "Standard_B4ms"
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
