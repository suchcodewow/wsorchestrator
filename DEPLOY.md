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

There are two deployed environments, QA and production. Both are built from
[infra/admin](infra/admin) and each is its own apply;
[docs/environments.md](docs/environments.md) maps one to the other. Three
Harness pipelines move a change through them, all in org `operations`, project
`orchestrator`:

```
pull request ─▶ verify                    typecheck + lint + unit-test (required check)

merge to main ─▶ deploy_qa                 (trigger deploy_qa_on_push_main)
       ├─ 0. Queue            one deploy_qa at a time
       ├─ 1. Verify
       ├─ 2. Infrastructure   IaCM apply of qa_control_plane
       └─ 3. Build/migrate/deploy (as build-sa@harnessevents-qa)
              ├─ build app + runner, push to QA's Artifact Registry
              ├─ db-migrate   ← before the new image is live
              └─ gcloud run services/jobs update

by hand ─▶ deploy_production               (sha = qa by default)
       ├─ 0. Queue            one deploy_production at a time
       ├─ 1. Preflight        resolve the commit; refuse if QA never built it,
       │                      it is not on main, or it is older than prod
       ├─ 2. Approval         prod_deployers only — every run, no exceptions
       ├─ 3. Infrastructure   IaCM apply of admin_control_plane (run_infra)
       └─ 4. Promote/migrate/deploy (as build-sa@administration-459416)
              ├─ crane copy app + runner from QA's registry to production's
              ├─ db-migrate
              └─ gcloud run services/jobs update
```

**Production never builds.** It promotes the exact image digest QA ran, so
nothing reaches production untested on QA. Production's build-sa can read QA's
registry because QA's workspace lists it in `image_readers`.

The pipelines are stored **INLINE in Harness** and mirrored for review in
[infra/admin/pipelines/](infra/admin/pipelines/). Those copies deploy nothing,
so **update both**. The IAM that each environment's `build-sa` needs beyond
building is gated on `enable_cicd` in [infra/admin/cicd.tf](infra/admin/cicd.tf).
Setting it false strips that environment's deploy and migrate steps of their
permissions.

`deploy_qa` takes four variables, each defaulting to the full path: `verify`,
`run_infra`, `apply_infra` and `deploy`. Running it by hand against a branch
with `deploy=false` and `apply_infra=false` exercises the pipeline without
changing QA.

`deploy_production` takes:

| Variable | Default | Meaning |
| --- | --- | --- |
| `sha` | `qa` | The commit to release. `qa` means whatever QA serves now; otherwise any SHA whose images QA built. |
| `run_infra` | `true` | Apply `admin_control_plane` before promoting. IaCM applies the head of `main`, so preflight refuses this when the commit's `infra/admin/*.tf` differs from main's. |
| `apply_infra` | `true` | With `run_infra`, apply rather than only plan. |
| `allow_rollback` | `false` | Permit a commit older than what production runs now. |

**Who can release.** Anyone in `orchestrator_developers` can start either
pipeline. Only `prod_deployers` can pass production's approval stage. The
Harness PAT used for API calls from a laptop belongs to its owner, so a run
started that way waits for the same approval. See
[docs/environments.md](docs/environments.md#who-can-do-what) for where this
gate is weaker than it looks.

> **This replaced a single push-to-production pipeline on 2026-09-29.** That
> pipeline, `deploy_workshop_orchestrator`, deployed every push to main
> straight to production. It is retired: its trigger is disabled and its only
> stage now fails with a pointer here.
>
> **That pipeline had in turn replaced a Cloud Build trigger on 2026-09-03.**
> [`cloudbuild.yaml`](cloudbuild.yaml) survives because `make images` still
> uses it for a manual build-and-push, and it is the break-glass route for when
> Harness itself is down. A step added there gates that route, **not** the
> deploy.

**Deploys queue rather than fight.** Each deploy pipeline starts with a Queue
step keyed on its own name, so a second run waits for the first. QA and
production use different workspaces and databases, so a QA deploy and a
production release can run at the same time.

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
> in `frontend/drizzle/`, or it will not reach QA or production.

The one exception is a database with **no tables at all**. There, `deploy_qa`
runs `drizzle-kit push` once to create the schema before the migrations. That
happens only when an environment is new: the migrations alone cannot build a
schema from nothing.

`make images` still only builds. The migrate and deploy steps in
`cloudbuild.yaml` are gated on the `_DEPLOY` substitution, which nothing sets
any more — they run only if someone invokes that file by hand.

### One-time setup

`enable_cicd = true` on the environment's workspace, then apply. The apply
grants `build-sa` what it needs beyond building: `run.admin` to roll the
service and jobs, `cloudsql.client` for the migration proxy, `secretAccessor` on
`database-url`, and `serviceAccountUser` scoped to just `app-sa` and
`runner-sa`. It is not project-wide, so build-sa cannot impersonate anything
else.

Each pipeline authenticates as its environment's `build-sa` with a JSON key held
in Harness's own secret manager:

- production: `gcp_build_sa_key` and `gcp_build_sa_key_b64`;
- QA: `gcp_qa_build_sa_key` and `gcp_qa_build_sa_key_b64`.

No key **exists on disk**. To replace one, mint a fresh key with `gcloud iam
service-accounts keys create`, store it in Harness, and revoke the old one
once a run verifies.

### Watching and rolling back

The deploys run in Harness, not Cloud Build, so `gcloud builds list` will not
show them. That command now only sees manual `make images` submissions.

```bash
# Executions
open "https://app.harness.io/ng/account/8mh-FIIHQUapLuB6K0Cd-w/all/orgs/operations/projects/orchestrator/pipelines/deploy_qa/executions"
open "https://app.harness.io/ng/account/8mh-FIIHQUapLuB6K0Cd-w/all/orgs/operations/projects/orchestrator/pipelines/deploy_production/executions"
```

**Roll production back** by running `deploy_production` with `sha=<older-sha>`,
`allow_rollback=true` and `run_infra=false`. It goes through the same approval.
Only a commit QA built can be chosen, which in practice is any commit merged
since QA existed.

**Roll QA back** by reverting the commit on `main` through a PR.

`make deploy TAG=<older-sha>` still works as **break-glass** for production. It
reads the local `admin_control_plane` outputs, needs the operator's own GCP
rights on the production project, and skips the approval. Use it only when
Harness is down.

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
