# bucket + prefix supplied by the runner at init. State is kept separate from
# the cluster's own state (a `delegate/gcp` subpath under the run prefix), so
# installing the delegate never touches the cluster's state object.
terraform {
  backend "gcs" {}
}
