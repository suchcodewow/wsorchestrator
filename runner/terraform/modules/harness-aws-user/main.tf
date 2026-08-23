# The IAM user Harness builds the workshop's AWS environment with — the AWS half
# of modules/harness-sa.
#
# Created inside the run's own member account (the caller passes the aliased
# member provider), so this credential can reach nothing outside it. That is
# also why it can safely hold AdministratorAccess: the account is the per-run
# isolation boundary and is closed at teardown.
#
# An IAM user with a long-lived key rather than a role, because a Harness
# connector authenticating manually is given a key pair — there is no ambient
# identity for it to assume from.
resource "aws_iam_user" "this" {
  name = var.name
  # Drops the access key below with the user, so teardown is not blocked by it.
  force_destroy = true
  tags          = var.labels
}

resource "aws_iam_user_policy_attachment" "this" {
  user       = aws_iam_user.this.name
  policy_arn = var.policy_arn
}

# The credential itself. Held in state (like the attendee passwords), which is
# how a retried or grown run re-uploads the same key instead of minting a new
# one and leaving the last one behind in Harness.
#
# Depends on the attachment so the key is not handed out a moment before the
# user can do anything with it.
resource "aws_iam_access_key" "this" {
  user = aws_iam_user.this.name

  depends_on = [aws_iam_user_policy_attachment.this]
}
