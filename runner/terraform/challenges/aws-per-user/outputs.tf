output "account_id" {
  value = aws_organizations_account.this.id
}

output "attendee_password" {
  value     = aws_iam_user_login_profile.attendee.password
  sensitive = true
}
