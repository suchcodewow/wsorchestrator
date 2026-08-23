variable "region" {
  description = "Region the EKS cluster is in (for the aws provider)."
  type        = string
}

variable "aws_account_id" {
  description = "The member account the cluster lives in; the provider assumes into it, the same way workshops/aws-base builds the cluster."
  type        = string
}

variable "account_access_role" {
  description = "Role assumed into the member account (OrganizationAccountAccessRole by default). It created the cluster, so it has cluster-admin."
  type        = string
}

variable "cluster_name" {
  description = "The EKS cluster to install the delegate into (makeClusterName)."
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
