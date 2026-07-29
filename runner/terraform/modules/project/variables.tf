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
  description = "Workshop attendee accounts to grant roles/editor on the project."
  type        = list(string)
  default     = []
}
