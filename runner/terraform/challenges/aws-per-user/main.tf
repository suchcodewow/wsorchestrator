# A challenge's AWS environment for ONE competitor: a member account they solely
# administer, and no cluster (building it is the challenge). The runner applies
# this root once per competitor — each with its own state prefix — because
# Terraform cannot create a dynamic number of cross-account providers in a
# single apply. The AWS mirror of challenges/gcp-per-user / azure-per-user, one
# account at a time.
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

resource "aws_iam_user" "attendee" {
  provider = aws.member

  name          = var.attendee_email
  force_destroy = true
  tags          = var.labels
}

resource "aws_iam_user_login_profile" "attendee" {
  provider = aws.member

  user                    = aws_iam_user.attendee.name
  password_reset_required = false
}

resource "aws_iam_user_policy_attachment" "attendee" {
  provider = aws.member

  user       = aws_iam_user.attendee.name
  policy_arn = var.attendee_policy_arn
}
