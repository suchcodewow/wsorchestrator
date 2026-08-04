# Install an org-scoped Harness delegate into a workshop's EKS cluster.
#
# The AWS mirror of delegates/gke: a separate, best-effort apply after the
# cluster is up. Like workshops/aws-base, the cluster lives in a member account,
# so the provider assumes OrganizationAccountAccessRole into it — that role
# created the cluster, so it holds cluster-admin and the Helm install
# authenticates with an EKS token minted for it.
provider "aws" {
  region = var.region

  assume_role {
    role_arn = "arn:aws:iam::${var.aws_account_id}:role/${var.account_access_role}"
  }
}

data "aws_eks_cluster" "this" {
  name = var.cluster_name
}

data "aws_eks_cluster_auth" "this" {
  name = var.cluster_name
}

provider "helm" {
  kubernetes {
    host                   = data.aws_eks_cluster.this.endpoint
    cluster_ca_certificate = base64decode(data.aws_eks_cluster.this.certificate_authority[0].data)
    token                  = data.aws_eks_cluster_auth.this.token
  }
}

module "delegate" {
  source = "../../modules/harness-delegate"

  delegate_name    = var.delegate_name
  delegate_token   = var.delegate_token
  account_id       = var.account_id
  manager_endpoint = var.manager_endpoint
  delegate_image   = var.delegate_image
}
