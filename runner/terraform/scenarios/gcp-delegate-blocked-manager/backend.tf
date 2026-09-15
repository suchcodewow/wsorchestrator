# bucket + prefix supplied by the runner at init:
#   terraform init -backend-config=bucket=<state-bucket> \
#                  -backend-config=prefix=<run-prefix>/scenarios/<scenario-id>
#
# The per-scenario prefix is what lets one scenario be turned off — destroyed —
# without touching another's state or the cluster underneath both.
terraform {
  backend "gcs" {}
}
