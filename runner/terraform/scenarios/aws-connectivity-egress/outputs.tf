# This root applies once per competitor, so its outputs describe one competitor;
# the runner merges them under that competitor's address.
output "scenario_aws_connectivity_egress_endpoints" {
  description = "The VPC endpoints keeping the cluster alive once the internet is gone."
  value       = [for e in aws_vpc_endpoint.interface : e.service_name]
}
