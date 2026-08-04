variable "delegate_name" {
  description = "Delegate name; also the Helm release name. DNS-1123, unique within the org (the runner suffixes the cluster name with the cloud)."
  type        = string
}

variable "delegate_token" {
  description = "An ORG-scoped Harness delegate token. Its scope is what registers the delegate at the organization level — the chart has no scope switch."
  type        = string
  sensitive   = true
}

variable "account_id" {
  description = "Harness account id the delegate registers to."
  type        = string
}

variable "manager_endpoint" {
  description = "Harness manager URL the delegate connects out to, e.g. https://app.harness.io."
  type        = string
}

variable "delegate_image" {
  description = "Override the delegate container image. Empty keeps the chart's own default, which is the right choice for a short-lived workshop cluster."
  type        = string
  default     = ""
}

variable "namespace" {
  description = "Namespace the delegate is installed into."
  type        = string
  default     = "harness-delegate-ng"
}

variable "timeout_seconds" {
  description = "How long to wait for the delegate rollout before failing the release. A fresh node has to pull the ~1 GB delegate image and the JVM has to register with Harness, so this allows generous margin on top of scheduling."
  type        = number
  default     = 900
}
