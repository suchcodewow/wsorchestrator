variable "subscription_id" {
  description = "Subscription the AKS cluster is in (for the azurerm provider)."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group holding the AKS cluster (the run's shared RG)."
  type        = string
}

variable "cluster_name" {
  description = "The AKS cluster to install the delegate into (makeClusterName)."
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
  description = "Delegate container image, resolved from Harness by the runner; empty falls back to the chart default."
  type        = string
  default     = ""
}
