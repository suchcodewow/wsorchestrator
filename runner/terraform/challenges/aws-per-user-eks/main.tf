# An EKS cluster in ONE competitor's member account, for a challenge whose
# scenarios need one to break.
#
# Per competitor, like everything else on AWS: the cluster goes inside an
# account this run already created (challenges/aws-per-user), and reaching into
# it means an assumed-role provider, which Terraform cannot create a dynamic
# number of in a single configuration. So the runner applies this root once per
# competitor — but concurrently, each against its own copy of the config and its
# own state prefix, because an EKS cluster takes something like fifteen minutes
# and a room of five should not wait an hour and a quarter.
#
# The account itself is *not* declared here. It belongs to the layer below, and
# a second declaration of it would be a second thing able to destroy it.
provider "aws" {
  region = var.region

  assume_role {
    role_arn = "arn:aws:iam::${var.account_id}:role/${var.account_access_role}"
  }
}

module "eks" {
  source = "../../modules/eks"

  cluster_name = var.cluster_name
  labels       = var.labels

  # The competitor's own IAM user, created in this account by the layer below
  # under their address. Constructed rather than looked up: a data source would
  # make this layer fail when the account exists but the user has not landed
  # yet, which is exactly the window a retry runs in. Keyed by address, as the
  # module wants — for_each needs plan-time keys.
  attendee_principal_arns = {
    (var.attendee_email) = "arn:aws:iam::${var.account_id}:user/${var.attendee_email}"
  }
}
