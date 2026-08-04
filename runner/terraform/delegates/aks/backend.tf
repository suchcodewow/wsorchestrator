# bucket + prefix supplied by the runner at init (a delegate/azure subpath under
# the run prefix), kept separate from the AKS cluster's own state.
terraform {
  backend "gcs" {}
}
