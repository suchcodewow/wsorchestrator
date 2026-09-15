# The `perCompetitor` scenario shape: one competitor per apply, so everything
# here is singular where a roster scenario's variables.tf is a map. A root takes
# one shape or the other, never both — scenario-catalog.test.ts checks that the
# shape matches what scenario.json declares.
#
# Copy this file verbatim into a new AWS scenario. Declare every variable even
# if the scenario uses none: an undeclared variable in the tfvars is a warning
# on every apply.

variable "attendee_email" {
  description = "The competitor this apply is for. Also the name of their IAM user in the account."
  type        = string
  default     = ""
}

variable "account_id" {
  description = "The competitor's member account. The provider assumes into it."
  type        = string
}

variable "cluster_name" {
  description = "Their EKS cluster, from the cluster layer. Read back with a data source rather than shared state, so this layer stays decoupled from the one that built it."
  type        = string
  default     = ""
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "account_access_role" {
  description = "Role in the member account the orchestrator assumes."
  type        = string
  default     = "OrganizationAccountAccessRole"
}

variable "labels" {
  type    = map(string)
  default = {}
}

variable "scenario_id" {
  description = "This scenario's id, so what it created says so on the resource."
  type        = string
  default     = ""
}

# Passed by the runner but not consumed directly; declared to avoid warnings.
variable "parent_ou_id" {
  type    = string
  default = ""
}

variable "run_id" {
  type    = string
  default = ""
}
