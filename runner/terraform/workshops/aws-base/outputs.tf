output "aws_account_id" {
  value = aws_organizations_account.this.id
}

# The region everything in this account was built in — the providers above, and
# so the EKS cluster. Recorded on the run because the attendee page opens the
# console there: an AWS account is global but its console is not, and a user
# dropped into the default region sees an empty EKS list and concludes the
# workshop is broken.
output "aws_region" {
  value = var.region
}

# The account's sign-in alias, so the frontend can rebuild the console link
# itself rather than depending on the stored URL below.
output "aws_account_alias" {
  value = aws_iam_account_alias.this.account_alias
}

# The account's sign-in page, pointed at the region the cluster is in.
#
# Keyed by alias, not account id: the id form of this host is answered with a
# 404. `region` is the parameter the signin endpoint acts on — it redirects to
# <region>.console.aws.amazon.com/console/home?region=<region>. (Its
# `redirect_uri` parameter does not do this: signin passes it through to the
# region-less console home as a literal query param and ignores it.) The alias
# subdomain prefills the account, so attendees never type the 12-digit number.
output "aws_console_url" {
  value = "https://${aws_iam_account_alias.this.account_alias}.signin.aws.amazon.com/console?region=${var.region}"
}

# AWS-generated console passwords, address -> password. Surfaced because — unlike
# the other clouds — AWS's password is not the shared Google one.
output "aws_attendee_passwords" {
  value = {
    for email, profile in aws_iam_user_login_profile.attendees :
    email => profile.password
  }
  sensitive = true
}

# The IAM user behind the event's Harness AWS connector, and its key. `one()`
# gives null when the module is switched off, which the runner reads as
# "nothing to connect".
output "harness_aws_user" {
  value = one(module.harness_user[*].user_name)
}

output "harness_aws_access_key_id" {
  value = one(module.harness_user[*].access_key_id)
}

# Consumed by the runner and then removed from the run's outputs — it is a live
# credential, so it is never stored on the run or rendered on the run page.
output "harness_aws_secret_access_key" {
  value     = one(module.harness_user[*].secret_access_key)
  sensitive = true
}

output "eks_cluster_name" {
  value = module.eks.cluster_name
}
