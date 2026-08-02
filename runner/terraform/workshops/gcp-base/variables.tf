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
  description = "APIs to enable in the workshop project. container.googleapis.com is needed for the GKE cluster."
  type        = list(string)
  default     = ["compute.googleapis.com", "container.googleapis.com"]
}

variable "cluster_name" {
  description = "Name of the workshop's GKE cluster. The runner passes k8s-<event>-<short>."
  type        = string
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
