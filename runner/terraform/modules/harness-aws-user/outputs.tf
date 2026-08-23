output "user_name" {
  value = aws_iam_user.this.name
}

output "access_key_id" {
  value = aws_iam_access_key.this.id
}

# Sensitive, and the runner strips it from the run's outputs after handing it to
# Harness, so it is never stored on the run or shown on the run page. The key id
# above is the identity half and stays.
output "secret_access_key" {
  value     = aws_iam_access_key.this.secret
  sensitive = true
}
