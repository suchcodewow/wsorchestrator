# Workshop runner (`tf-runner` / `tf-reaper`)

One container image, two entrypoints, run as **Cloud Run Jobs** under
`runner-sa` (no key files — Terraform uses the job's ADC).

- **`run`** — reads `RUN_ID`, provisions one workshop:
  `provisioning` → create project + link billing + enable APIs →
  `applying` (`terraform apply`) → `ready` (outputs + `expires_at`).
  Streams every Terraform line into `run_logs`.
- **`reap`** — finds runs past `expires_at` (or failed) and destroys them:
  `terraform destroy` → project delete → `destroyed`. Cloud Scheduler fires
  this every few minutes.

## How a run maps to Terraform

`workshops.tf_source` (e.g. `workshops/gke-starter`) selects a root config under
[`terraform/workshops/`](terraform/workshops). The runner:

1. writes `terraform.tfvars.json` (project id, folder, billing, region, labels),
2. `terraform init` with the GCS backend `-backend-config=prefix=<state_prefix>`
   (per-run state in the admin bucket),
3. `terraform apply` / `destroy`.

Each root wires the shared [`modules/project`](terraform/modules/project)
(project + billing + APIs) to a workshop content module. Adding a workshop =
add a module + a root config + a `workshops` DB row.

## Env

`DATABASE_URL`, `GCP_TFSTATE_BUCKET`, `GCP_WORKSHOPS_FOLDER_ID`,
`GCP_BILLING_ACCOUNT_ID`, `GCP_ADMIN_PROJECT_ID`, `GCP_REGION` — all supplied by
the Cloud Run Job definitions in `infra/admin/runner.tf`.

## Build & push

```bash
REPO=us-central1-docker.pkg.dev/<admin-project>/workshop-orchestrator
docker build -t $REPO/runner:latest .
docker push $REPO/runner:latest
# then set runner_image in infra/admin/terraform.tfvars and re-apply
```
