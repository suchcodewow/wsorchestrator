# bucket + prefix supplied by the runner at init:
#   terraform init -backend-config=bucket=<state-bucket> -backend-config=prefix=<run-prefix>
terraform {
  backend "gcs" {}
}
