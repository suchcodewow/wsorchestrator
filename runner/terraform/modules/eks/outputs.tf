output "cluster_name" {
  value = aws_eks_cluster.this.name
}

output "cluster_endpoint" {
  value = aws_eks_cluster.this.endpoint
}

# What a challenge scenario needs to reach into the network this module built.
# Derived here rather than re-derived by the caller, so there is one definition
# of which VPC and which security group a node actually sits on.

output "vpc_id" {
  value = aws_vpc.this.id
}

output "subnet_ids" {
  description = "Node subnets. Where a scenario puts VPC endpoints, so they are reachable from the nodes."
  value       = aws_subnet.public[*].id
}

output "node_security_group_id" {
  description = "The cluster security group, which EKS attaches to the managed node group. A scenario narrowing egress targets this."
  value       = aws_eks_cluster.this.vpc_config[0].cluster_security_group_id
}

output "vpc_cidr" {
  value = aws_vpc.this.cidr_block
}
