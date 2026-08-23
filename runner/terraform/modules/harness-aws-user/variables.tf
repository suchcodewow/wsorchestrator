variable "name" {
  description = "IAM user name. The runner derives it from the run, so it matches the GCP service account and the Azure app registration of the same event."
  type        = string
}

variable "policy_arn" {
  description = <<-EOT
    Policy attached to the user. AdministratorAccess by default — the Harness
    connector built on this key administers the run's own member account, so the
    pipelines a workshop runs can create and delete infrastructure in it.
  EOT
  type        = string
  default     = "arn:aws:iam::aws:policy/AdministratorAccess"
}

variable "labels" {
  type    = map(string)
  default = {}
}
