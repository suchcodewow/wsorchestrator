variable "attendee_resource_groups" {
  description = <<-EOT
    Competitor address -> the resource group their cluster goes in. The same map
    challenges/azure-per-user was applied with, recomputed by the runner from
    the roster (challengeResourceGroupMap) rather than passed between layers, so
    growing a challenge adds a key and leaves the existing clusters untouched in
    state.
  EOT
  type        = map(string)
  default     = {}
}

variable "cluster_prefix" {
  description = "Leading part of each cluster's name; the competitor's resource group supplies the unique remainder."
  type        = string
  default     = "k8s"
}

variable "vnet_cidr" {
  description = "Address space for each competitor's vnet. They never peer, so the same range in every competitor's own resource group is fine."
  type        = string
  default     = "10.0.0.0/16"
}

variable "subnet_cidr" {
  description = "Node subnet within the vnet. Sized well above the node count so Azure CNI has addresses for pods too."
  type        = string
  default     = "10.0.0.0/20"
}

variable "subscription_id" {
  type = string
}

variable "location" {
  type    = string
  default = "eastus"
}

variable "labels" {
  type    = map(string)
  default = {}
}

# Passed by the runner but not consumed directly; declared to avoid warnings.
variable "tenant_id" {
  type    = string
  default = ""
}

variable "run_id" {
  type    = string
  default = ""
}
