# Maps a custom domain to the app service with a Google-managed TLS cert.
# Created only when var.custom_domain is set. After apply, add the DNS records
# from the `domain_dns_records` output at your DNS host, then wait for the cert.
resource "google_cloud_run_domain_mapping" "app" {
  count = var.custom_domain != "" ? 1 : 0

  name     = var.custom_domain
  location = var.region
  project  = var.admin_project_id

  metadata {
    namespace = var.admin_project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.app.name
  }
}

# The DNS records to create at your registrar (subdomain -> a CNAME to
# ghs.googlehosted.com). Read with: tofu output domain_dns_records
output "domain_dns_records" {
  value = var.custom_domain != "" ? google_cloud_run_domain_mapping.app[0].status[0].resource_records : []
}
