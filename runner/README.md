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
3. **Harness organization** named after the workshop, with **one project per
   attendee** ([`src/harness.ts`](src/harness.ts)). Each attendee is invited as
   an administrator of their own project and as a viewer at the org level, so
   they can see everyone's work but only change their own. This happens for
   every workshop — it is not one of the `clouds`.
4. **Per cloud** — `gcp` applies [`terraform/workshops/gcp-base`](terraform/workshops/gcp-base),
   which wires [`modules/project`](terraform/modules/project) to create the
   ephemeral project, link billing, enable APIs, and grant every attendee
   `roles/editor` on it. `aws` and `azure` are accepted by the form and logged
   as not yet wired up.

Harness identifiers can't contain hyphens and must not collide with reserved
words, so names are put through `harnessIdentifier()` rather than reusing the
slug: the workshop "Team Onboarding — East" becomes `Team_Onboarding_East_<run>`
and `bouncy-penguin` becomes project `bouncy_penguin`. The org identifier
carries a slice of the run id because organization identifiers must be unique
across the whole Harness account and two workshops may share a name. Nothing
extra is stored — teardown re-derives both identifiers the same way.

Terraform state is per-run in the admin bucket
(`-backend-config=prefix=<state_prefix>`).

## Env

`DATABASE_URL`, `GCP_TFSTATE_BUCKET`, `GCP_WORKSHOPS_FOLDER_ID`,
`GCP_BILLING_ACCOUNT_ID`, `GCP_ADMIN_PROJECT_ID`, `GCP_REGION`,
`GOOGLE_WORKSPACE_DOMAIN`, `GOOGLE_WORKSPACE_ADMIN_EMAIL`,
`GOOGLE_WORKSPACE_PARENT_OU`, `HARNESS_ACCOUNT_ID`, `HARNESS_API_KEY`,
`HARNESS_BASE_URL` — all supplied by the Cloud Run Job definitions in
`infra/admin/runner.tf` (`DATABASE_URL` and `HARNESS_API_KEY` from Secret
Manager). `TF_BIN` overrides the OpenTofu binary (defaults to `tofu`; set to
`terraform` on a machine that only has that).

The image ships **OpenTofu**, not Terraform, because the committed
`.terraform.lock.hcl` files pin providers from `registry.opentofu.org`.
Terraform resolves the same providers from `registry.terraform.io`, so running
it here would leave those pins inert and re-resolve providers on every init.

`HARNESS_ACCOUNT_ID` and `HARNESS_API_KEY` are required for **every** run,
since each workshop provisions Harness. The built-in role and resource-group
identifiers default to `_project_admin` / `_all_project_level_resources` and
`_organization_viewer` / `_all_organization_level_resources`; override them with
`HARNESS_PROJECT_ADMIN_ROLE`, `HARNESS_PROJECT_ADMIN_RESOURCE_GROUP`,
`HARNESS_ORG_VIEWER_ROLE`, and `HARNESS_ORG_VIEWER_RESOURCE_GROUP` if the
account uses different ones.

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
