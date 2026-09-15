# Every GCP scenario root takes this same set, so the runner has one tfvars
# writer for all of them (writeScenarioTfvars). A root that does not need one of
# these still declares it — an undeclared variable in the file is a warning on
# every apply, and a scenario author should be able to copy this file verbatim.

variable "attendee_projects" {
  description = "Competitor address -> their GCP project id."
  type        = map(string)
  default     = {}
}

variable "network_names" {
  description = "Competitor address -> the VPC their cluster is on, from the cluster layer's output of the same name."
  type        = map(string)
  default     = {}
}

variable "node_tags" {
  description = "Competitor address -> the network tag on their cluster's nodes. Scoping to this is what keeps one competitor's scenario off another's environment."
  type        = map(string)
  default     = {}
}

variable "region" {
  type    = string
  default = "us-west1"
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
variable "run_id" {
  type    = string
  default = ""
}
