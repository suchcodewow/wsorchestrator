variable "project_id" {
  description = "The long-lived shared testing project attendees are granted access to. This config never creates or destroys it — only manages IAM bindings on it."
  type        = string
}

variable "attendee_emails" {
  description = "Attendee accounts to grant, written by the runner after it creates them in Workspace. The whole roster is passed each apply so a grown workshop converges."
  type        = list(string)
  default     = []
}

variable "attendee_role" {
  description = "Role each attendee gets on the shared project."
  type        = string
  default     = "roles/editor"
}

variable "cluster_name" {
  description = "Name of this run's GKE cluster in the shared project. The runner passes k8s-<event>-<short>."
  type        = string
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "labels" {
  type    = map(string)
  default = {}
}

# Passed by the runner's common tfvars but unused here — this config never
# creates a project, so it has no folder, billing account, or admin project to
# consume. Declared to avoid "value for undeclared variable" warnings.
variable "folder_id" {
  type    = string
  default = ""
}

variable "billing_account" {
  type    = string
  default = ""
}

variable "admin_project_id" {
  type    = string
  default = ""
}

variable "run_id" {
  type    = string
  default = ""
}
