# State lives in the same GCS bucket every run uses; the runner supplies bucket
# and (azure-namespaced) prefix at init. The state backend is independent of the
# cloud being managed, so an Azure run still stores its state in GCS.
terraform {
  backend "gcs" {}
}
