variable "region" {
  type    = string
  default = "us-east-1"
}

variable "account_name" {
  description = "Name/alias of the per-run member account — the isolation boundary, analog of the GCP project."
  type        = string
}

variable "account_email" {
  description = "Unique root email the account is registered under (plus-addressed by the runner)."
  type        = string
}

variable "parent_ou_id" {
  description = "OU to create the account under. Empty means the organization root."
  type        = string
  default     = ""
}

variable "account_access_role" {
  description = "Role the management account assumes into the new account to build inside it."
  type        = string
  default     = "OrganizationAccountAccessRole"
}

variable "cluster_name" {
  description = "Name of the workshop's EKS cluster. The runner passes k8s-<event>-<short>."
  type        = string
}

variable "attendee_emails" {
  description = "Attendee addresses. Each becomes an IAM user of the same name with console access."
  type        = list(string)
  default     = []
}

variable "attendee_policy_arn" {
  description = "Managed policy each attendee gets. PowerUserAccess is the analog of editor on a shared GCP project — full use of services, but not IAM administration."
  type        = string
  default     = "arn:aws:iam::aws:policy/PowerUserAccess"
}

variable "labels" {
  description = "Tags applied to every resource."
  type        = map(string)
  default     = {}
}

variable "run_id" {
  type    = string
  default = ""
}
