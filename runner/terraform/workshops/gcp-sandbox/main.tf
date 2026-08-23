# Grants a run's attendees access to a single long-lived "sandbox" project,
# used when a run is created with no cloud selected. This is for fast testing:
# it skips the slow create-project / destroy-project cycle entirely.
#
# The defining property, versus gcp-base: this config never creates or destroys
# the project itself. It manages additive `google_project_iam_member` bindings
# for the run's own attendees, plus a per-run GKE cluster (with its own network)
# named after the run. So `terraform destroy` at teardown removes just this
# run's grants and its cluster — never the shared project or anyone else's
# bindings. Two runs can share the project at once; each run's state owns only
# its own attendees' access and its own cluster.
provider "google" {
  region = var.region
}

# The attendee accounts are created via the Admin SDK moments before this runs,
# and IAM rejects a member it cannot resolve yet, so wait for them to propagate
# before binding — the same guard gcp-base relies on. Keyed on the attendee set
# so a grown workshop waits again for its newly added accounts.
resource "time_sleep" "account_propagation" {
  create_duration = "60s"

  triggers = {
    attendees = join(",", sort(var.attendee_emails))
  }
}

resource "google_project_iam_member" "attendees" {
  for_each = toset(var.attendee_emails)

  project = var.project_id
  role    = var.attendee_role
  member  = "user:${each.value}"

  depends_on = [time_sleep.account_propagation]
}

# The no-cloud path builds the same small GKE cluster gcp-base does, in the
# shared project. Unlike gcp-base there is no project module to enable APIs, so
# enable the ones the cluster and the Harness connector's service account need
# here — with disable_on_destroy = false so teardown drops them from THIS run's
# state without disabling them for a concurrent no-cloud run that is still using
# its own cluster. On a project that already has these enabled (the usual case
# for the shared sandbox) this is a no-op that simply adopts them into state.
resource "google_project_service" "gke_apis" {
  for_each = toset([
    "compute.googleapis.com",
    "container.googleapis.com",
    "iam.googleapis.com",
  ])

  project                    = var.project_id
  service                    = each.value
  disable_on_destroy         = false
  disable_dependent_services = false
}

resource "time_sleep" "api_propagation" {
  depends_on      = [google_project_service.gke_apis]
  create_duration = "60s"
}

# The identity this run's Harness Google Cloud connector authenticates as.
# Per-run like the cluster, so two no-cloud runs sharing the project each own
# their own account, and destroy takes exactly one of them with it — which also
# revokes the key Harness held, on a project that itself is never destroyed.
module "harness_sa" {
  source = "../../modules/harness-sa"
  count  = var.service_account_id == "" ? 0 : 1

  project_id   = var.project_id
  account_id   = var.service_account_id
  display_name = "Harness connector (${var.service_account_id})"
  role         = var.service_account_role

  # Waits on the same propagation sleep the cluster does: the shared project may
  # not have had the IAM API on before this run enabled it above.
  depends_on = [time_sleep.api_propagation]
}

# Named per-run (k8s-<event>-<short>) with its own network, so it coexists with
# other runs' clusters in the shared project and destroy removes exactly this
# one.
module "gke" {
  source       = "../../modules/gke"
  project_id   = var.project_id
  cluster_name = var.cluster_name
  region       = var.region
  zone_letter  = var.zone_letter
  labels       = var.labels

  depends_on = [time_sleep.api_propagation]
}
