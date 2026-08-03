variable "region" {
  type    = string
  default = "us-east-1"
}

variable "account_name" {
  description = "Name/alias of this competitor's own account."
  type        = string
}

variable "account_email" {
  description = "Unique root email the account is registered under (plus-addressed by the runner)."
  type        = string
}

variable "parent_ou_id" {
  type    = string
  default = ""
}

variable "account_access_role" {
  type    = string
  default = "OrganizationAccountAccessRole"
}

variable "attendee_email" {
  description = "The single competitor this account belongs to; becomes an IAM user of the same name."
  type        = string
}

variable "attendee_policy_arn" {
  description = "A challenge competitor owns their account, so they get AdministratorAccess (the AWS analog of owner on a per-competitor GCP project)."
  type        = string
  default     = "arn:aws:iam::aws:policy/AdministratorAccess"
}

variable "labels" {
  type    = map(string)
  default = {}
}

variable "run_id" {
  type    = string
  default = ""
}
