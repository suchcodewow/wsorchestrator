variable "project_id" {
  type = string
}

variable "folder_id" {
  type = string
}

variable "billing_account" {
  type = string
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "labels" {
  type    = map(string)
  default = {}
}

variable "activate_apis" {
  description = "APIs to enable in the workshop project."
  type        = list(string)
  default     = ["compute.googleapis.com"]
}

variable "attendee_emails" {
  description = "Attendee accounts, written by the runner after it creates them in Workspace."
  type        = list(string)
  default     = []
}

# Passed by the runner but not consumed directly; declared to avoid warnings.
variable "admin_project_id" {
  type    = string
  default = ""
}

variable "run_id" {
  type    = string
  default = ""
}
