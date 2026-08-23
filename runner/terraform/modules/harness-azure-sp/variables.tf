variable "name" {
  description = "Display name of the app registration. The runner derives it from the run, so it matches the GCP service account and the AWS IAM user of the same event."
  type        = string
}

variable "scope" {
  description = "Resource ID the principal is granted `role` on — the workshop's resource group."
  type        = string
}

variable "role" {
  description = <<-EOT
    Role the principal is granted at `scope`. Owner by default — the Harness
    connector built on these credentials administers the resource group, so the
    pipelines a workshop runs can create and delete infrastructure in it.
  EOT
  type        = string
  default     = "Owner"
}
