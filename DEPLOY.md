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

A push to `main` verifies the commit, applies infrastructure, builds both
images, applies the SQL migrations, and rolls Cloud Run — via the
`deploy_on_push_main` webhook trigger on the Harness pipeline
`deploy_workshop_orchestrator` (org `operations`, project `orchestrator`).

```
push to main
  └─ Harness: deploy_workshop_orchestrator
       ├─ 1. Verify              typecheck + unit-test the runner
       ├─ 2. Infrastructure      IaCM apply of the admin_control_plane workspace
       └─ 3. Build/migrate/deploy (as build-sa)
              ├─ build app + runner images
              ├─ push both to Artifact Registry
              ├─ db-migrate   ← before the new image is live
              └─ gcloud run services/jobs update
```

The pipeline is stored **INLINE in Harness** and mirrored for review at
[infra/admin/deploy-pipeline.yml](infra/admin/deploy-pipeline.yml). That copy
deploys nothing — **update both**. The IAM that `build-sa` needs beyond building
is gated on `enable_cicd` in [infra/admin/cicd.tf](infra/admin/cicd.tf); setting
it false strips the pipeline's deploy and migrate steps of their permissions.

The pipeline takes four variables, all defaulting to the full path: `verify`,
`run_infra`, `apply_infra`, and `deploy`. Running it by hand with
`deploy=false` and `apply_infra=false` is the way to exercise CI against a
branch without touching production.

> **This replaced a Cloud Build trigger on 2026-09-03.** That trigger, its
> GitHub App connection, and the repository link were deleted from the admin
> project at the cutover — leaving them would have meant two systems racing to
> deploy the same commit. [`cloudbuild.yaml`](cloudbuild.yaml) survives at the
> repo root because `make images` still uses it for a manual build-and-push,
> and as a break-glass route for when Harness itself is down. A step added
> there gates that route, **not** the deploy.

**Two deploys running at once will fight.** They apply OpenTofu against the same
IaCM workspace and migrate the same database. There is no concurrency limit on
the pipeline today, so if someone has just pushed, let their run finish before
you push.

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
`cloudbuild.yaml` are gated on the `_DEPLOY` substitution, which nothing sets
any more — they run only if someone invokes that file by hand.

### One-time setup

`enable_cicd = true` in `infra/admin/terraform.tfvars`, then `make infra`. The
apply grants `build-sa` what it needs beyond building: `run.admin` to roll the
service and jobs, `cloudsql.client` for the migration proxy, `secretAccessor` on
`database-url`, and `serviceAccountUser` scoped to just `app-sa` and
`runner-sa` — not project-wide, so it cannot impersonate anything else. Setting
it false is the kill switch: the pipeline's deploy and migrate steps lose their
permissions.

The pipeline authenticates as `build-sa` via a JSON key held in Harness's own
secret manager. That key **exists nowhere on disk** — if it has to be replaced,
mint a fresh one with `gcloud iam service-accounts keys create`, store it in
Harness, and revoke the superseded one once a run verifies.

### Watching and rolling back

The deploy runs in Harness, not Cloud Build, so `gcloud builds list` will not
show it — that command now only sees manual `make images` submissions.

```bash
# The pipeline's executions
open "https://app.harness.io/ng/account/8mh-FIIHQUapLuB6K0Cd-w/all/orgs/operations/projects/orchestrator/pipelines/deploy_workshop_orchestrator/executions"

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
