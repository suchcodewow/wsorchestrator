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

variable "admin_project_id" {
  type    = string
  default = ""
}

variable "run_id" {
  type    = string
  default = ""
}
