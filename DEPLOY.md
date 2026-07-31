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

# 3. Build + push images, redeploy onto them, apply schema
make ship
```

`make ship` = `images` → `deploy` → `db-migrate` → `db-push`, and prints the
app URL.

Finally, add `<app_url>/api/auth/callback/google` as an authorized redirect URI
on the OAuth client.

## Day-to-day

```bash
make ship          # rebuild + redeploy current commit, run migrations
make deploy        # just roll Cloud Run to the current commit's images
make db-backup     # on-demand Cloud SQL backup (take one before schema changes)
make db-migrate    # apply the SQL migrations in frontend/drizzle (data backfills)
make db-push       # apply schema changes only
make info          # show the resolved config (project, repo, db, tag, url)
make help          # list targets
```

Images are tagged with the git short SHA, so `make deploy` is a precise,
repeatable roll-forward (and roll-back: `make deploy TAG=<older-sha>`).

**To confirm what is actually live, open the app's user menu** — the bottom line
shows the short SHA the running image was built from and when it was built
(hover for the exact instant). That is stamped into the image at build time by
[`cloudbuild.yaml`](cloudbuild.yaml), so it describes the image serving the
page, not the last deploy that happened to run: after a rollback it correctly
reads the older SHA. A menu showing `dev` means the container is running an
image built outside the pipeline.

`make deploy` calls `gcloud run services update` rather than `terraform apply`.
The Cloud Run resources declare `ignore_changes` on their image, so Terraform
no longer moves the running tag — otherwise any unrelated `apply` would reset
production to whatever `app_image` happened to be passed. This also means a
manual roll-back and an automated deploy take the same code path.

## Continuous deployment

A push to `main` builds both images, applies the SQL migrations, and rolls
Cloud Run — via the `deploy-on-push-main` Cloud Build trigger in
[infra/admin/cicd.tf](infra/admin/cicd.tf).

```
push to main
  └─ Cloud Build (runs as build-sa)
       ├─ build app + runner images
       ├─ push both to Artifact Registry
       ├─ db-migrate   ← before the new image is live
       └─ gcloud run services/jobs update
```

**Migrations run before the deploy, on purpose.** The `.sql` files only add
columns with defaults, so the currently-running revision keeps working against
the migrated schema. The reverse order would put a new image in front of a
schema missing the columns it reads on every request — the app calls
`getThemePreference()` in the root layout, so a missing column is a 500 on
every route, including `/signin`.

**CI runs `db-migrate` only, never `db-push`.** `db-push` diffs shape and will
drop a column whose data is still needed; unattended on every push that is a
data-loss risk. The consequence is a rule worth internalising:

> A change to `frontend/src/db/schema.ts` **must** be paired with a migration
> in `frontend/drizzle/`, or it will not reach production.

`make images` still only builds. The migrate and deploy steps in
`cloudbuild.yaml` are gated on the `_DEPLOY` substitution, which only the
trigger sets.

### One-time setup

Terraform cannot create a GitHub App installation or a PAT, so three steps are
manual. Until they are done, leave `enable_cicd = false` and nothing in
`cicd.tf` is created.

```bash
# 1. Install the Cloud Build GitHub App on the repo, and note the installation
#    id from the URL it redirects to (.../installations/<ID>):
#      https://github.com/apps/google-cloud-build

# 2. Store a classic PAT (scopes: repo, read:user) in Secret Manager
printf '%s' <TOKEN> | gcloud secrets create github-pat \
  --data-file=- --project <ADMIN_PROJECT>

# 3. In infra/admin/terraform.tfvars:
#      enable_cicd                = true
#      github_owner               = "suchcodewow"
#      github_repo                = "wsorchestrator"
#      github_app_installation_id = "<ID from step 1>"

make infra
```

The apply also grants `build-sa` what it now needs beyond building: `run.admin`
to roll the service and jobs, `cloudsql.client` for the migration proxy,
`secretAccessor` on `database-url`, and `serviceAccountUser` scoped to just
`app-sa` and `runner-sa` — not project-wide, so it cannot impersonate anything
else.

### Watching and rolling back

```bash
gcloud builds list --region us-central1 --limit 5 --project <ADMIN_PROJECT>
gcloud builds log <BUILD_ID> --region us-central1 --project <ADMIN_PROJECT>

make deploy TAG=<older-sha>   # roll back; migrations are not reverted
```

Rolling back the image does **not** roll back the schema. That is safe in the
one direction the migrations are written for — they are additive, so an older
image simply ignores the newer columns.

## Schema changes

Two mechanisms, and the order matters:

- **`db-push`** (Drizzle) diffs [frontend/src/db/schema.ts](frontend/src/db/schema.ts) onto the
  database. It handles additive and cosmetic changes, but it only knows about
  *shape* — it will happily drop a column or table whose data is still needed,
  and it cannot add a `NOT NULL` column to a table that already has rows.
- **`db-migrate`** applies the ordered `.sql` files in
  [frontend/drizzle/](frontend/drizzle/) via
  [frontend/scripts/apply-sql.mjs](frontend/scripts/apply-sql.mjs). This is
  where anything that has to *move data* lives.

`ship` runs `db-migrate` first so the data is reshaped before `db-push` diffs
the result. Each migration wraps itself in a transaction and is written to be
re-runnable, so a partial failure commits nothing and a repeat run is a no-op.

Before any schema change against production, take a backup:

```bash
make db-backup     # then verify in the console before proceeding
```

## How the wiring fits together

- **Cloud Build** ([cloudbuild.yaml](cloudbuild.yaml)) builds both images in the
  cloud — no local Docker or cross-arch fuss.
- **`with-db.sh`** ([scripts/with-db.sh](scripts/with-db.sh)) fetches the
  `database-url` secret, swaps the connector socket for a local proxy, and runs
  Drizzle against Cloud SQL — same credentials the app uses, no copies.
- **Terraform outputs** are the single source of truth the Makefile reads from.
