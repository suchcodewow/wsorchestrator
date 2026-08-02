variable "subscription_id" {
  description = "The long-lived subscription workshop resource groups are created in."
  type        = string
}

variable "tenant_id" {
  description = "Entra tenant the attendee users are created in."
  type        = string
}

variable "location" {
  type    = string
  default = "eastus"
}

variable "resource_group_name" {
  description = "Per-run resource group — the isolation boundary, the analog of the GCP project."
  type        = string
}

variable "cluster_name" {
  description = "Name of the workshop's AKS cluster. The runner passes k8s-<event>-<short>."
  type        = string
}

# Emails and passwords are split so the (non-sensitive) emails can drive
# for_each: Terraform refuses to use a sensitive value as a resource key.
variable "attendee_emails" {
  description = "Attendee addresses. Each becomes a native Entra user whose UPN is the address, so the same username works across every cloud the workshop selects."
  type        = list(string)
  default     = []
}

variable "attendee_passwords" {
  description = "Attendee address -> temp password, the same credential as the attendee's Google account."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "attendee_role" {
  description = "Azure RBAC role each attendee gets on the shared resource group. Contributor is the analog of editor on a shared GCP project — create/manage resources, but not alter the RG's own access."
  type        = string
  default     = "Contributor"
}

variable "labels" {
  type    = map(string)
  default = {}
}

# Passed by the runner's tfvars but not consumed directly; declared to avoid
# "value for undeclared variable" warnings.
variable "run_id" {
  type    = string
  default = ""
}
