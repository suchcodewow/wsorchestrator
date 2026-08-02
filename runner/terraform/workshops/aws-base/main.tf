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
#     (Creating an account and using it in the same apply can need a two-phase
#     apply the first time if the provider sees the account id as unknown.)
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

module "eks" {
  source       = "../../modules/eks"
  cluster_name = var.cluster_name
  labels       = var.labels

  providers = {
    aws = aws.member
  }
}
