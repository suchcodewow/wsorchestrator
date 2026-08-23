output "account_id" {
  value = aws_organizations_account.this.id
}

# The sign-in alias this competitor's console link is keyed by — the account-id
# form of that host 404s. Collected per competitor by the runner.
output "account_alias" {
  value = aws_iam_account_alias.this.account_alias
}

output "attendee_password" {
  value     = aws_iam_user_login_profile.attendee.password
  sensitive = true
}
