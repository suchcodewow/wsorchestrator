# bucket + prefix supplied by the runner at init:
#   terraform init -backend-config=bucket=<state-bucket> \
#                  -backend-config=prefix=<run-prefix>/aws/cluster/<competitor-slug>
#
# One state object per competitor, which is what lets their clusters be built —
# and rebuilt — concurrently without sharing a lock.
terraform {
  backend "gcs" {}
}
