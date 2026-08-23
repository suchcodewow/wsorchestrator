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

variable "service_account_id" {
  description = "Id of the service account the event's Harness Google Cloud connector authenticates as. Named after the run, so several no-cloud runs can hold their own in the one shared project. Empty creates no account and no key."
  type        = string
  default     = ""
}

variable "service_account_role" {
  description = "Project role that service account is granted. Owner, so Harness pipelines can administer the project."
  type        = string
  default     = "roles/owner"
}

variable "cluster_name" {
  description = "Name of this run's GKE cluster in the shared project. The runner passes k8s-<event>-<short>."
  type        = string
}

variable "region" {
  type    = string
  default = "us-west1"
}

variable "zone_letter" {
  description = "Which zone of the region hosts the zonal GKE cluster. The runner walks the region's zones here to dodge GCE capacity stockouts; defaults to a so teardown (which omits it) still targets a valid location."
  type        = string
  default     = "a"
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
