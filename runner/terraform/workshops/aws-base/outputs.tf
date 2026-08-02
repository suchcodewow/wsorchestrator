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

output "eks_cluster_name" {
  value = module.eks.cluster_name
}
