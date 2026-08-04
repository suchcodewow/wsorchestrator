# Install an org-scoped Harness delegate into a Kubernetes cluster via Helm.
#
# Cloud-agnostic: the caller configures the `helm` provider against the target
# cluster (GKE, AKS, or EKS), so the same module serves all three. Organization
# scope comes from the delegate token, which the runner mints at the org level;
# the chart itself takes no scope argument.
#
# The runner treats the whole delegate step as best-effort — a failure here
# never fails the workshop — so `wait`/`atomic` are on to surface a genuine
# failure quickly and roll a half-installed release back rather than leaving it
# pending. Teardown is implicit: when the reaper destroys the cluster, the
# delegate goes with it, and Harness prunes the delegate as it stays offline.

resource "helm_release" "delegate" {
  name             = var.delegate_name
  repository       = "https://app.harness.io/storage/harness-download/delegate-helm-chart"
  chart            = "harness-delegate-ng"
  namespace        = var.namespace
  create_namespace = true

  wait            = true
  atomic          = true
  cleanup_on_fail = true
  timeout         = var.timeout_seconds

  set {
    name  = "delegateName"
    value = var.delegate_name
  }

  set_sensitive {
    name  = "delegateToken"
    value = var.delegate_token
  }

  set {
    name  = "accountId"
    value = var.account_id
  }

  set {
    name  = "managerEndpoint"
    value = var.manager_endpoint
  }

  # One replica is plenty for a workshop cluster.
  set {
    name  = "replicas"
    value = "1"
  }

  # A workshop cluster lives an hour or two; the auto-upgrader would only churn
  # it (and pull images) for no benefit.
  set {
    name  = "upgrader.enabled"
    value = "false"
  }

  # Only pin the image when explicitly overridden; otherwise the chart's own
  # default (kept current by Harness) is the right image for the chart version.
  dynamic "set" {
    for_each = var.delegate_image != "" ? [var.delegate_image] : []
    content {
      name  = "delegateDockerImage"
      value = set.value
    }
  }
}
