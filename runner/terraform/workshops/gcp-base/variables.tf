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
