# The roster scenario shape, Azure flavour: maps keyed by competitor address,
# one apply covering all of them. Copy verbatim into a new Azure scenario and
# declare every variable even if it goes unused — an undeclared variable in the
# tfvars is a warning on every apply.

variable "attendee_resource_groups" {
  description = "Competitor address -> their resource group."
  type        = map(string)
  default     = {}
}

variable "subnet_ids" {
  description = "Competitor address -> their cluster's node subnet, from the cluster layer's output of the same name. This is what an NSG or route table attaches to."
  type        = map(string)
  default     = {}
}

variable "cluster_names" {
  description = "Competitor address -> their AKS cluster."
  type        = map(string)
  default     = {}
}

variable "subscription_id" {
  type = string
}

variable "location" {
  type    = string
  default = "eastus"
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
variable "tenant_id" {
  type    = string
  default = ""
}

variable "run_id" {
  type    = string
  default = ""
}
