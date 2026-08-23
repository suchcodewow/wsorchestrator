output "email" {
  value = google_service_account.this.email
}

# The credential JSON, as a service account key file reads on disk — the
# provider returns it base64-encoded. Sensitive, and the runner strips it from
# the run's outputs after handing it to Harness, so it is never stored on the
# run or shown on the run page.
output "key_json" {
  value     = base64decode(google_service_account_key.this.private_key)
  sensitive = true
}
