variable "project_id" {
  type = string
}

variable "folder_id" {
  description = "Numeric folder ID the project is created under."
  type        = string
}

variable "billing_account" {
  type = string
}

variable "region" {
  type = string
}

variable "labels" {
  type    = map(string)
  default = {}
}

variable "activate_apis" {
  description = "APIs to enable in the new project."
  type        = list(string)
  default     = []
}

variable "attendee_emails" {
  description = "Accounts to grant `attendee_role` on the project."
  type        = list(string)
  default     = []
}

variable "attendee_role" {
  description = <<-EOT
    Role granted to each address in `attendee_emails`. Workshops share one
    project, so attendees get editor and cannot alter its IAM. A challenge
    competitor owns their own project, so they get owner (administrator).
  EOT
  type        = string
  default     = "roles/editor"
}
