# Deploying

The [`Makefile`](Makefile) ties the pieces together. It reads all config from
Terraform outputs, so once the control plane exists you never repeat project
ids, regions, or registry paths.

## Prerequisites

- `gcloud` authenticated with rights to the admin project + workshops folder +
  billing account (see [infra/admin/README.md](infra/admin/README.md)).
- `terraform` **or** `tofu` (auto-detected), and `cloud-sql-proxy` (v2) on PATH.
- Google OAuth client created; `google_oauth_client_id/secret` set in
  `infra/admin/terraform.tfvars`.

## First deploy

```bash
# 0. Fill in infra/admin/terraform.tfvars (copy from the .example)

# 1. Create the admin config's own state bucket + init the backend
make bootstrap ADMIN_PROJECT=<admin> STATE_BUCKET=<admin>-infra-tfstate

# 2. Stand up the control plane (placeholder images the first time)
make infra

# 3. Build + push images, redeploy onto them, apply schema, seed
make ship
```

`make ship` = `images` → `deploy` → `db-push` → `seed`, and prints the app URL.

Finally, add `<app_url>/api/auth/callback/google` as an authorized redirect URI
on the OAuth client.

## Day-to-day

```bash
make ship          # rebuild + redeploy current commit, run migrations + seed
make deploy        # just roll Cloud Run to the current commit's images
make db-push       # apply schema changes only
make info          # show the resolved config (project, repo, db, tag, url)
make help          # list targets
```

Images are tagged with the git short SHA, so `make deploy` is a precise,
repeatable roll-forward (and roll-back: `make deploy TAG=<older-sha>`).

## How the wiring fits together

- **Cloud Build** ([cloudbuild.yaml](cloudbuild.yaml)) builds both images in the
  cloud — no local Docker or cross-arch fuss.
- **`with-db.sh`** ([scripts/with-db.sh](scripts/with-db.sh)) fetches the
  `database-url` secret, swaps the connector socket for a local proxy, and runs
  Drizzle against Cloud SQL — same credentials the app uses, no copies.
- **Terraform outputs** are the single source of truth the Makefile reads from.
