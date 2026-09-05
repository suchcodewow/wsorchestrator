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
  description = "Node VM size. Standard_D4as_v6 (4 vCPU / 16 GB, AMD general-purpose) is the AKS analog of GKE's e2-standard-4 — sized so the org Harness delegate at its default 1-CPU request fits alongside AKS's (heavier) system pods and workshop workload. A 2-vCPU node could not schedule it reliably. Was Standard_B4ms until that hit a wall: the burstable Bs family is a legacy series whose quota Azure will not raise at all (a request returns DeprecatedQuotaType), so 10 regional vCPUs — two workshops — was a permanent ceiling. Its own v2 successors were no help: Bsv2/Basv2 are not offered on this subscription in eastus, and Bpsv2 is Arm64, which the amd64 delegate image cannot run. Dropping burstable is a bonus rather than a cost here, since B-series CPU credits throttle exactly when a room full of attendees hits the cluster at once. Note that vCPU quota is per family AND per region, so changing this needs quota in the new size's family (D4as_v6 is standardDav6Family) on top of Total Regional vCPUs."
  type        = string
  default     = "Standard_D4as_v6"
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
