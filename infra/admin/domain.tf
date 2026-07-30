# Maps each custom domain to the app service, with a Google-managed TLS cert
# per domain. After apply, create the DNS records from the
# `domain_dns_records` output at your DNS host, then wait for the certs.
#
# Every domain listed here is *served*; only one of them is canonical. The
# canonical one is whichever `app_url` points at — see CANONICAL_HOST in app.tf
# and the middleware that acts on it. Serving the same app on two hosts without
# a redirect would break sign-in, because Auth.js pins a single AUTH_URL and
# Google matches the OAuth redirect_uri exactly.
locals {
  # Host part of app_url: strip the scheme, then anything from the first
  # slash or colon. "https://harnessevents.io/" -> "harnessevents.io".
  canonical_host = var.app_url == "" ? "" : regex(
    "^[^/]*",
    replace(replace(var.app_url, "https://", ""), "http://", ""),
  )
}

resource "google_cloud_run_domain_mapping" "app" {
  for_each = toset(var.custom_domains)

  name     = each.value
  location = var.region
  project  = var.admin_project_id

  metadata {
    namespace = var.admin_project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.app.name
  }
}

# The DNS records to create at your registrar, keyed by domain. An apex gets
# four A + four AAAA records; a subdomain gets one CNAME to ghs.googlehosted.com.
# Read with: tofu output domain_dns_records
output "domain_dns_records" {
  description = "domain -> the DNS records Google expects for it."
  value = {
    for d, m in google_cloud_run_domain_mapping.app :
    d => m.status[0].resource_records
  }
}
