# The AWS environment for a workshop: one new member account (the per-run
# isolation boundary), an IAM user per attendee with console access and
# PowerUserAccess, and a small EKS cluster. The AWS mirror of workshops/gcp-base
# and azure-base, with two AWS-specific differences:
#
#   * Passwords are AWS-generated (surfaced in outputs), not the shared Google
#     password — a login profile cannot be set to a chosen password, so AWS is
#     the one cloud whose password differs.
#   * The account is created by the management account, then an aliased provider
#     assumes OrganizationAccountAccessRole into it to build everything inside.
#     Because that role's ARN is unknown until the account exists, the member
#     provider is only truly assumed at apply time — at plan it falls back to the
#     management credentials. Creates are unaffected, but any read through it has
#     to be kept out of the plan (see the module's depends_on below).
provider "aws" {
  region = var.region
}

resource "aws_organizations_account" "this" {
  name              = var.account_name
  email             = var.account_email
  parent_id         = var.parent_ou_id != "" ? var.parent_ou_id : null
  role_name         = var.account_access_role
  close_on_deletion = true

  lifecycle {
    ignore_changes = [role_name]
  }
}

provider "aws" {
  alias  = "member"
  region = var.region

  assume_role {
    role_arn = "arn:aws:iam::${aws_organizations_account.this.id}:role/${var.account_access_role}"
  }
}

resource "aws_iam_user" "attendees" {
  provider = aws.member
  for_each = toset(var.attendee_emails)

  name          = each.value
  force_destroy = true # drop the user's access keys/etc. so teardown succeeds
  tags          = var.labels
}

# Console password is AWS-generated and returned in outputs. No forced reset, to
# match the other clouds' accounts (which likewise no longer force a change).
resource "aws_iam_user_login_profile" "attendees" {
  provider = aws.member
  for_each = aws_iam_user.attendees

  user                    = each.value.name
  password_reset_required = false
}

resource "aws_iam_user_policy_attachment" "attendees" {
  provider = aws.member
  for_each = aws_iam_user.attendees

  user       = each.value.name
  policy_arn = var.attendee_policy_arn
}

# The identity the event's Harness AWS connector authenticates as, inside the
# run's own member account. Its secret access key leaves here in a sensitive
# output, which the runner uploads to Harness and then drops (see
# `linkAwsToHarness`). count, so a deployment that would rather not hand out a
# long-lived key can turn the whole thing off by passing an empty
# harness_user_name.
module "harness_user" {
  source = "../../modules/harness-aws-user"
  count  = var.harness_user_name == "" ? 0 : 1

  name       = var.harness_user_name
  policy_arn = var.harness_user_policy_arn
  labels     = var.labels

  providers = {
    aws = aws.member
  }

  # Same reason as the EKS module below: nothing in here may be read before the
  # account exists, or the aliased provider is still the management user.
  depends_on = [aws_organizations_account.this]
}

module "eks" {
  source       = "../../modules/eks"
  cluster_name = var.cluster_name
  labels       = var.labels

  # Attendees need a Kubernetes access entry each; PowerUserAccess gets them to
  # the EKS API but not past the cluster's RBAC.
  #
  # Keyed by email, not a bare list of ARNs: an ARN embeds the member account
  # id, which is unknown until apply, and for_each keys have to be known at
  # plan time. The emails are static input, so they key the map and the
  # apply-time ARNs ride along as values.
  attendee_principal_arns = { for email, u in aws_iam_user.attendees : email => u.arn }

  providers = {
    aws = aws.member
  }

  # The module looks up availability zones. Without this, that read runs during
  # plan — before the account exists, so aws.member is still the management user
  # and the call comes back 403 from the wrong account. Depending on the account
  # defers every read in the module to apply, once the role is really assumed.
  depends_on = [aws_organizations_account.this]
}
