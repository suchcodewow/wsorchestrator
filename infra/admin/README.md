# Admin-project Terraform (control plane)

Stands up everything durable in the **admin project**: the Terraform state
bucket, Cloud SQL, service accounts + IAM (folder/billing scoped), Secret
Manager, Artifact Registry, the Cloud Run app service, and the
`tf-runner` / `tf-reaper` Cloud Run Jobs + reaper schedule.

Ephemeral **workshop projects** are created at runtime by `tf-runner` — they are
not managed here.

## What gets created

| File | Resources |
| --- | --- |
| `apis.tf` | Enables required APIs on the admin project |
| `state.tf` | GCS bucket for per-run workshop state |
| `iam.tf` | `runner-sa`, `app-sa`, `scheduler-sa` + role bindings |
| `database.tf` | Cloud SQL (Postgres 16), `workshops` DB, `appuser` |
| `secrets.tf` | Secret Manager: DB URL, auth secret, Google OAuth |
| `registry.tf` | Artifact Registry Docker repo |
| `runner.tf` | `tf-runner` + `tf-reaper` Cloud Run Jobs |
| `app.tf` | Cloud Run service (Next.js app), public invoker |
| `scheduler.tf` | Cloud Scheduler → reaper job |

## IAM model (the important part)

- **`runner-sa`** — `roles/owner` **on the workshops folder** (broad inside the
  sandbox, powerless outside it), plus `projectCreator`, `projectDeleter`,
  `serviceUsageAdmin` on the folder, `billing.user` on the billing account,
  `storage.objectAdmin` on the state bucket, and `cloudsql.client` +
  `logging.logWriter` on the admin project.
- **`app-sa`** — `cloudsql.client`, `logging.logWriter`, `secretAccessor` on the
  app secrets, and `run.invoker` on the `tf-runner` job. **No** project-creation
  power.
- **`scheduler-sa`** — `run.invoker` on the `tf-reaper` job only.

## Prerequisites

- The admin project exists and your identity has, at the org/folder level:
  `resourcemanager.folderIamAdmin` (to grant folder roles) and
  `billing.admin` on the billing account (to grant `billing.user`).
- The `workshops` folder exists; you have its numeric ID.
- `gcloud` authenticated (`gcloud auth application-default login`), `terraform`
  and `gcloud` on PATH.

## Deploy

```bash
cd infra/admin
cp terraform.tfvars.example terraform.tfvars   # fill in values

# 1) Bootstrap this config's own state bucket + backend init
ADMIN_PROJECT=<admin> REGION=us-central1 \
  STATE_BUCKET=<admin>-infra-tfstate ./scripts/bootstrap.sh

# 2) Review + apply (uses placeholder images the first time)
terraform plan  -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars
```

The first apply uses the public `cloudrun/hello` image for the app and runner so
everything stands up cleanly. In **step #3** you'll build the real images, push
them to the Artifact Registry repo (see the `artifact_registry` output), set
`app_image` / `runner_image` in `terraform.tfvars`, and re-apply.

## Outputs

`terraform output` gives you the app URL, the DB connection name (for
`cloud-sql-proxy` during local migrations), the state bucket, the Artifact
Registry path, and the SA emails.

## Notes

- `deletion_protection = false` and no DB backups: this is the **testing**
  posture. Turn both on before anything real.
- Cloud SQL has a public IP but **no authorized networks** — reach it only via
  the connector socket (Cloud Run) or `cloud-sql-proxy` locally.
