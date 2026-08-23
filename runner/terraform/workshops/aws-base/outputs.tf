output "aws_account_id" {
  value = aws_organizations_account.this.id
}

output "aws_console_url" {
  value = "https://${aws_organizations_account.this.id}.signin.aws.amazon.com/console"
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
