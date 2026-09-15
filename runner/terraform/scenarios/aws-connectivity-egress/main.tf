# Connectivity: Egress (AWS) — the nodes can reach AWS, and nothing else.
#
# The AWS analog of gcp-connectivity-egress, and the most true-to-life of the
# three clouds': a locked-down enterprise VPC is survivable *only* because of
# its VPC endpoints, and the failure engineers actually hit is a missing one.
# So this scenario builds the endpoints and then takes the internet away —
# ordered, not simultaneous. Reverse that order and the nodes lose their path to
# the control plane mid-apply, and the cluster is broken rather than instructive.
#
# What the competitor sees: pods pulling from ECR are fine, pods pulling from
# Docker Hub or quay.io sit in ImagePullBackOff, and a Harness delegate never
# registers. Nothing here allowlists Harness — earning that is the challenge.
#
# perCompetitor, and not by choice: this reaches into one competitor's member
# account, which needs an assumed-role provider, and Terraform cannot create a
# dynamic number of those in one configuration. The runner applies this root
# once per competitor, concurrently.
provider "aws" {
  region = var.region

  assume_role {
    role_arn = "arn:aws:iam::${var.account_id}:role/${var.account_access_role}"
  }
}

data "aws_eks_cluster" "this" {
  name = var.cluster_name
}

data "aws_route_tables" "vpc" {
  vpc_id = data.aws_eks_cluster.this.vpc_config[0].vpc_id
}

locals {
  vpc_id     = data.aws_eks_cluster.this.vpc_config[0].vpc_id
  subnet_ids = data.aws_eks_cluster.this.vpc_config[0].subnet_ids
  node_sg    = data.aws_eks_cluster.this.vpc_config[0].cluster_security_group_id

  # The interface endpoints a private EKS cluster genuinely needs. ecr.api and
  # ecr.dkr are the pair people forget — the first authenticates the pull, the
  # second serves it, and having only one gives a confusing half-failure.
  interface_services = [
    "ecr.api",
    "ecr.dkr",
    "sts",
    "ec2",
    "elasticloadbalancing",
    "logs",
  ]
}

# Everything reaching an endpoint arrives from inside the VPC on 443.
resource "aws_security_group" "endpoints" {
  name        = "${var.cluster_name}-endpoints"
  description = "Challenge scenario ${var.scenario_id}: ingress to the VPC endpoints."
  vpc_id      = local.vpc_id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.this.cidr_block]
  }

  tags = var.labels
}

data "aws_vpc" "this" {
  id = local.vpc_id
}

resource "aws_vpc_endpoint" "interface" {
  for_each = toset(local.interface_services)

  vpc_id              = local.vpc_id
  service_name        = "com.amazonaws.${var.region}.${each.value}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = local.subnet_ids
  security_group_ids  = [aws_security_group.endpoints.id]
  private_dns_enabled = true

  tags = merge(var.labels, { Name = "${var.cluster_name}-${each.value}" })
}

# S3 is a gateway endpoint, not interface — and it is not optional: ECR stores
# the image layers themselves in S3, so without this a pull authenticates and
# then hangs.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = local.vpc_id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = data.aws_route_tables.vpc.ids

  tags = merge(var.labels, { Name = "${var.cluster_name}-s3" })
}

# --- Only now, take the internet away ---
#
# `aws_vpc_security_group_egress_rule` replaces the allow-all egress EKS puts on
# the cluster security group. depends_on is the load-bearing part: the endpoints
# must exist first, or the nodes lose the control plane before they have another
# route to it.

resource "aws_vpc_security_group_egress_rule" "vpc_only" {
  security_group_id = local.node_sg
  description       = "Challenge scenario ${var.scenario_id}: inside the VPC only."
  cidr_ipv4         = data.aws_vpc.this.cidr_block
  ip_protocol       = "-1"

  tags = var.labels

  depends_on = [aws_vpc_endpoint.interface, aws_vpc_endpoint.s3]
}
