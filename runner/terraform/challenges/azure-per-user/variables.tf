variable "subscription_id" {
  type = string
}

variable "tenant_id" {
  type = string
}

variable "location" {
  type    = string
  default = "eastus"
}

variable "attendee_resource_groups" {
  description = "Competitor address -> the resource group they solely own."
  type        = map(string)
  default     = {}
}

variable "attendee_passwords" {
  description = "Competitor address -> temp password, same credential as their Google account."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "attendee_role" {
  description = "A challenge competitor owns their own resource group, so they get Owner (the analog of owner on a challenge's per-competitor GCP project)."
  type        = string
  default     = "Owner"
}

variable "labels" {
  type    = map(string)
  default = {}
}

variable "run_id" {
  type    = string
  default = ""
}
