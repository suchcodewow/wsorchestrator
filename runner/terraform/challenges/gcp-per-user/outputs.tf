output "gcp_projects" {
  description = "Competitor address -> their project id."
  value       = { for email, p in module.project : email => p.project_id }
}

output "gcp_console_urls" {
  description = "Competitor address -> the console for their own project."
  value = {
    for email, p in module.project :
    email => "https://console.cloud.google.com/home/dashboard?project=${p.project_id}"
  }
}
