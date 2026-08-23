output "client_id" {
  value = azuread_application.this.client_id
}

output "tenant_id" {
  value = data.azuread_client_config.current.tenant_id
}

output "display_name" {
  value = azuread_application.this.display_name
}

# Sensitive, and the runner strips it from the run's outputs after handing it to
# Harness, so it is never stored on the run or shown on the run page.
output "client_secret" {
  value     = azuread_application_password.this.value
  sensitive = true
}
