output "cluster_name" {
  value = module.eks.cluster_name
}

output "cluster_endpoint" {
  value = module.eks.cluster_endpoint
}

output "vpc_id" {
  value = module.eks.vpc_id
}

output "node_security_group_id" {
  value = module.eks.node_security_group_id
}

output "credentials_command" {
  description = "The aws command that points this competitor's kubectl at their cluster."
  value = join(" ", [
    "aws eks update-kubeconfig",
    "--region", var.region,
    "--name", module.eks.cluster_name,
  ])
}
