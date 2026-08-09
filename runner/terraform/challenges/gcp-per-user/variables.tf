variable "attendee_projects" {
  description = <<-EOT
    Competitor address -> the GCP project id to create for them. Written by the
    runner after it creates the accounts in Workspace. Keyed by address so that
    adding a competitor to a live challenge leaves the existing projects
    untouched in state.
  EOT
  type        = map(string)
  default     = {}
}

variable "folder_id" {
  type = string
}

variable "billing_account" {
  type = string
}

variable "region" {
  type    = string
  default = "us-west1"
}

variable "labels" {
  type    = map(string)
  default = {}
}

variable "activate_apis" {
  description = "APIs to enable in each competitor's project."
  type        = list(string)
  default     = ["compute.googleapis.com"]
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
