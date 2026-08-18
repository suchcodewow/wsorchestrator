# A deliberately small, cheap EKS cluster for a workshop — the AWS analog of
# modules/gke and modules/aks. Unlike those, the EKS control plane is NOT free
# (~$0.10/hr with no free tier), so this is the pricier of the three; the rest
# is kept minimal: a single small on-demand node and public subnets so no NAT
# gateway is needed (a NAT would add ~$32/mo).
#
# Nodes are ON_DEMAND, not SPOT: a workshop cluster must not be reclaimed out
# from under attendees mid-session — the same call the GKE/AKS modules make.

# Read through whichever provider the caller passes, so the zone names come from
# the account the cluster is built in. workshops/aws-base builds that account in
# the same apply, so it depends_on the account and this read lands at apply time
# rather than plan — which is why the subnet count below is var.az_count and not
# length(local.azs): a plan-time-unknown count is a hard error.
data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, var.az_count)
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = merge(var.labels, { Name = "${var.cluster_name}-vpc" })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = merge(var.labels, { Name = "${var.cluster_name}-igw" })
}

resource "aws_subnet" "public" {
  count = var.az_count

  vpc_id                  = aws_vpc.this.id
  availability_zone       = local.azs[count.index]
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  map_public_ip_on_launch = true

  tags = merge(var.labels, {
    Name                     = "${var.cluster_name}-public-${count.index}"
    "kubernetes.io/role/elb" = "1"
  })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = merge(var.labels, { Name = "${var.cluster_name}-public" })
}

resource "aws_route_table_association" "public" {
  count = length(aws_subnet.public)

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# --- Control-plane and node IAM roles ---
data "aws_iam_policy_document" "cluster_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cluster" {
  name               = "${var.cluster_name}-cluster"
  assume_role_policy = data.aws_iam_policy_document.cluster_assume.json
  tags               = var.labels
}

resource "aws_iam_role_policy_attachment" "cluster" {
  role       = aws_iam_role.cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

data "aws_iam_policy_document" "node_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "node" {
  name               = "${var.cluster_name}-node"
  assume_role_policy = data.aws_iam_policy_document.node_assume.json
  tags               = var.labels
}

resource "aws_iam_role_policy_attachment" "node" {
  for_each = toset([
    "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
    "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
    "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
  ])

  role       = aws_iam_role.node.name
  policy_arn = each.value
}

# --- Cluster + managed node group ---
resource "aws_eks_cluster" "this" {
  name     = var.cluster_name
  role_arn = aws_iam_role.cluster.arn

  vpc_config {
    subnet_ids             = aws_subnet.public[*].id
    endpoint_public_access = true
  }

  # Access entries, not just the aws-auth ConfigMap. Left unset, EKS defaults a
  # new cluster to CONFIG_MAP, where the only principal with Kubernetes access
  # is the role that created it — attendees would see the cluster in the console
  # and get "Unauthorized" from kubectl, because their IAM permissions say
  # nothing about Kubernetes RBAC. API_AND_CONFIG_MAP is what lets the access
  # entries below grant them in, and keeps the ConfigMap path working for the
  # node group.
  #
  # The bootstrap line is not decoration: it defaults to true but reads back as
  # null if the block omits it, and it forces replacement — so leaving it out
  # plans a brand-new cluster for an existing workshop. It also has to stay
  # true, since the assumed role's admin is how the delegate install and any
  # later apply reach the cluster at all.
  access_config {
    authentication_mode                         = "API_AND_CONFIG_MAP"
    bootstrap_cluster_creator_admin_permissions = true
  }

  # The control plane needs its policy attached before it will come up.
  depends_on = [aws_iam_role_policy_attachment.cluster]

  tags = var.labels
}

resource "aws_eks_node_group" "this" {
  cluster_name    = aws_eks_cluster.this.name
  node_group_name = "default"
  node_role_arn   = aws_iam_role.node.arn
  subnet_ids      = aws_subnet.public[*].id

  scaling_config {
    desired_size = var.node_count
    min_size     = var.node_count
    max_size     = var.node_count
  }

  instance_types = [var.instance_type]
  disk_size      = var.disk_size_gb
  capacity_type  = "ON_DEMAND"

  depends_on = [aws_iam_role_policy_attachment.node]

  tags = var.labels
}

# --- Attendee access ---
# The AWS analog of roles/editor carrying GKE access and Contributor carrying
# AKS access: an IAM user is a stranger to the cluster's RBAC until it has an
# access entry, however much IAM it holds. Cluster admin matches what the other
# two clouds hand an attendee, and the account is theirs for the workshop
# anyway. The creator role is deliberately not listed — it already has admin
# from bootstrap_cluster_creator_admin_permissions, and an access entry for it
# would collide with that.
resource "aws_eks_access_entry" "attendees" {
  for_each = toset(var.attendee_principal_arns)

  cluster_name  = aws_eks_cluster.this.name
  principal_arn = each.value
  type          = "STANDARD"
  tags          = var.labels
}

resource "aws_eks_access_policy_association" "attendees" {
  for_each = aws_eks_access_entry.attendees

  cluster_name  = aws_eks_cluster.this.name
  principal_arn = each.value.principal_arn
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"

  access_scope {
    type = "cluster"
  }
}
