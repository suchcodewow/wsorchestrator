variable "project_id" {
  description = "Project the service account is created in and granted `role` on."
  type        = string
}

variable "account_id" {
  description = "Service account id (the local part of its address). 6-30 chars, starts with a letter; the runner derives it from the run."
  type        = string
}

variable "display_name" {
  type    = string
  default = "Harness workshop service account"
}

variable "role" {
  description = <<-EOT
    Project role the account is granted. Owner by default — the Harness
    connector built on this key administers the project, so the pipelines a
    workshop runs can create and delete infrastructure in it.
  EOT
  type        = string
  default     = "roles/owner"
}
