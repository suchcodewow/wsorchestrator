variable "account_id" {
  description = "The member account this competitor's cluster goes in, created by challenges/aws-per-user. The provider assumes into it."
  type        = string
}

variable "attendee_email" {
  description = "The competitor this account belongs to. Also the name of their IAM user in it, which is what gets Kubernetes access to the cluster."
  type        = string
}

variable "cluster_name" {
  description = "Cluster name, derived by the runner from the account name so it already carries a per-competitor hash."
  type        = string
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "account_access_role" {
  description = "Role in the member account the orchestrator assumes. Created by AWS Organizations when the account was made."
  type        = string
  default     = "OrganizationAccountAccessRole"
}

variable "labels" {
  type    = map(string)
  default = {}
}

# Passed by the runner but not consumed directly; declared to avoid warnings.
variable "parent_ou_id" {
  type    = string
  default = ""
}

variable "run_id" {
  type    = string
  default = ""
}
