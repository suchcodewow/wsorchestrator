# Workshop runner (`tf-runner` / `tf-reaper`)

One container image, two entrypoints, run as **Cloud Run Jobs** under
`runner-sa` (no key files — Terraform uses the job's ADC).

- **`run`** — reads `RUN_ID`, provisions one workshop:
  `provisioning` (Workspace OU + attendee accounts) → `applying`
  (`terraform apply` per requested cloud) → `ready` (outputs + `expires_at`).
  Streams every Terraform line into `run_logs`.
- **`reap`** — finds runs past `expires_at` (or failed) and destroys them:
  `terraform destroy` → project delete → accounts deleted → OU deleted →
  `destroyed`. Cloud Scheduler fires this every few minutes.
- **`provision-due`** — cron entrypoint that claims `scheduled` runs whose start
  time has arrived and triggers a `run` execution for each.

## What a run creates

A run is self-describing: a name, an attendee count, and a set of clouds.

1. **Google Workspace OU** named after the workshop, under
   `GOOGLE_WORKSPACE_PARENT_OU`.
2. **`user_count` accounts** in that OU, named from the adjective/noun lists in
   [`src/usernames.ts`](src/usernames.ts) — `bouncy-penguin@<domain>`, shown in
   Workspace as "Bouncy Penguin". Each address is checked against the Directory
   API before it is claimed, so an account that already exists is never reused;
   if the plain combinations keep colliding a numeric suffix is added. Each gets
   a generated temporary password and `changePasswordAtNextLogin`, stored in
   `workshop_accounts` for the organizer to hand out.
3. **Per cloud** — `gcp` applies [`terraform/workshops/gcp-base`](terraform/workshops/gcp-base),
   which wires [`modules/project`](terraform/modules/project) to create the
   ephemeral project, link billing, and enable APIs. `aws` and `azure` are
   accepted by the form and logged as not yet wired up.

Terraform state is per-run in the admin bucket
(`-backend-config=prefix=<state_prefix>`).

## Env

`DATABASE_URL`, `GCP_TFSTATE_BUCKET`, `GCP_WORKSHOPS_FOLDER_ID`,
`GCP_BILLING_ACCOUNT_ID`, `GCP_ADMIN_PROJECT_ID`, `GCP_REGION`,
`GOOGLE_WORKSPACE_DOMAIN`, `GOOGLE_WORKSPACE_ADMIN_EMAIL`,
`GOOGLE_WORKSPACE_PARENT_OU` — all supplied by the Cloud Run Job definitions in
`infra/admin/runner.tf`. `TF_BIN` overrides the Terraform binary (e.g. `tofu`).

The GCP vars are read lazily, so a workshop that requests no GCP environment
provisions its accounts without them.

### Workspace access

The Directory API rejects service accounts acting as themselves, so `runner-sa`
needs **domain-wide delegation** in the Workspace admin console for:

```
https://www.googleapis.com/auth/admin.directory.orgunit
https://www.googleapis.com/auth/admin.directory.user
```

and impersonates `GOOGLE_WORKSPACE_ADMIN_EMAIL` (a super-admin).

## Build & push

```bash
REPO=us-central1-docker.pkg.dev/<admin-project>/workshop-orchestrator
docker build -t $REPO/runner:latest .
docker push $REPO/runner:latest
# then set runner_image in infra/admin/terraform.tfvars and re-apply
```
