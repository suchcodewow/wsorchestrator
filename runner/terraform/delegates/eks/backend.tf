# bucket + prefix supplied by the runner at init (a delegate/aws subpath under
# the run prefix), kept separate from the EKS cluster's own state.
terraform {
  backend "gcs" {}
}
