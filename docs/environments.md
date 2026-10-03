# Environments: QA and production

There are two deployments of the app. Both are built from the same
`infra/admin` module, but each is a separate apply with its own project,
database, secrets and identities.

| | **Production** | **QA** |
| --- | --- | --- |
| URL | https://harnessevents.io | https://qa.harnessevents.io |
| GCP admin project | `administration-459416` | `harnessevents-qa` |
| Where its workshop projects go | folder `522401695842` (workshops) | folder `688190860371` (qa-workshops, inside `orchestrator-qa` `158960058878`) |
| Harness IaCM workspace | `admin_control_plane` | `qa_control_plane` |
| Identity that applies it | `tf-admin-sa@administration-459416` (connector `gcp_tf_admin`) | `tf-admin-qa@harnessevents-qa` (connector `gcp_tf_admin_qa`) |
| Identity that builds and deploys it | `build-sa@administration-459416` (connector `gcp_build_sa`) | `build-sa@harnessevents-qa` (connector `gcp_qa_build_sa`) |
| Deployed by | `deploy_production`: run by hand | `deploy_qa`: every push to `main` |
| Workspace OU for attendees | `/` (one OU per run under it) | `/QA` |
| Header badge | none | amber `qa` |

## How a change moves

```
branch ──PR──▶ verify (required check) ──merge──▶ main
                                                   │
                                  deploy_qa (automatic, every push to main)
                                                   │
                                     QA: qa.harnessevents.io
                                                   │
                            deploy_production (by hand)
                                                   │
                                   production: harnessevents.io
```

- **`main` is protected** by the GitHub ruleset `protect-main`. It requires a
  pull request and blocks force-pushes and branch deletion. Repository admins
  (Shawn) can bypass it. Everyone else merges through a PR.
- **Merging deploys QA and nothing else.** `deploy_qa` verifies, applies
  `qa_control_plane`, builds both images into QA's registry, migrates QA's
  database, and rolls QA's Cloud Run.
- **Production is a promotion, not a build.** `deploy_production` copies the
  image `deploy_qa` built from QA's registry into production's, so production
  runs exactly what QA ran. Its preflight refuses a commit that is not on
  `main`, that QA never built, or that is older than what production runs now
  (unless `allow_rollback=true`). It also refuses when `infra/admin/*.tf`
  differs between the commit and the head of `main`, because IaCM always
  applies the head of `main`. There is **no approval stage**: a run that
  passes preflight releases.

Promote whatever QA is serving now:

```
Harness → deploy_production → Run → sha = qa (the default)
```

Roll back production to an older commit that QA built:

```
deploy_production with sha=<older sha>, allow_rollback=true, run_infra=false
```

Rolling back never reverts migrations. That is safe because migrations are
additive: an older image simply ignores newer columns.

## What the two share, and why that matters

Only the GCP side is separate. The rest is shared:

| Shared | Consequence |
| --- | --- |
| Harness account `8mh-FIIHQUapLuB6K0Cd-w` (workshop orgs are created in it) | A QA run creates a real Harness org. The ids carry a run-id suffix, so they never collide with production's. |
| AWS organization OU `ou-soom-m1awl627` | A QA run with AWS creates, and closes, a real AWS account. The number of accounts AWS lets you close is limited, so **prefer no-cloud or GCP runs on QA.** |
| Azure subscription | As with AWS: real resource groups. |
| Google Workspace `harnessevents.io` | QA attendees are real Workspace users, inside `/QA`. |
| Google OAuth client | One client serves both environments. Each environment's callback URL is registered on it. |
| HiBob credentials | Both run the nightly HiBob sync. It is read-only against HiBob. |

Each environment's **Cloud Status** page lists everything in the shared
accounts, so QA shows production's resources as orphans and production shows
QA's. The page is read-only, and these entries are expected.

The GCP billing account is shared too. `gcp_infra_project_ids` lists the other
environment's admin and sandbox projects, so they show as infra rather than
orphans. Its default is QA's pair, for production. QA overrides it on
`qa_control_plane` with `["administration-459416", "sbx-administration-459416"]`.
The page shows projects named `event-…` as *Created elsewhere*, not as orphans.
Another team bills them to the same account.

## Never copy production data into QA, except by importing a backup

The reaper works from its own database's `workshop_runs` rows. It tears down
the Workspace OU and users, the Harness org, and the cloud accounts those rows
name. Production rows restored into QA's database would give QA's reaper
production's live workshops to destroy, and the shared accounts above mean
nothing stops it. So do not copy rows into QA by hand, with `pg_dump`, a
`gcloud sql backups restore`, or anything else, not even "just the content
tables".

There is one supported way to get production's data onto QA: **Backups →
Production backups → Import**, on QA. It exists so production's guides and
events can be looked at on QA, and everything it does is there to keep QA's
runner off them.

### What the import does

The page starts a `tf-runner` execution with the args `import-production`
(`runner/src/import-production.ts`). In order:

1. **Refuses** anywhere but QA, and while QA has events of its own that still
   hold resources (any status but `scheduled` or `destroyed`). The restore
   would erase the only record of them. The page lists them.
2. **Takes a snapshot** of QA's users who have any access, with their roles
   and Google account links.
3. **Pauses** `tf-reaper-trigger` and `tf-scheduler-trigger`, then refuses if
   any other `tf-runner`, `tf-reaper` or `tf-scheduler` execution is running.
4. **Backs up QA**, on demand, described as "Before importing production
   backup …". Restoring that backup from the same page undoes the import.
5. **Restores** production's backup over QA's instance, then puts QA's
   `appuser` password back, since the restore brings production's.
6. **Quarantines** the restored database: every `workshop_runs` row is
   stamped `environment = 'production'`, and production's sessions and pending
   secret scrubs (`harness_deployed_secrets`) are deleted. From here the runner
   and the app treat every one of those runs as someone else's.
7. **Calls the app's finish step** (`POST /api/backups/production/finish`,
   OIDC as QA's runner-sa). That applies QA's migrations, deletes production's
   saved credentials (Harness tokens, org secrets, template sources, API
   tokens, invites, OAuth tokens), blanks imported attendee passwords, and
   sets every role back to the snapshot. Production's users stay in the
   database with no access.
8. **Resumes** the triggers.

### What the environment stamp does

`workshop_runs.environment` records which deployment created a run. The
runner and the app both read their own from `DEPLOYMENT_ENVIRONMENT`, which
is unset, and so `production`, on production. Under a local `next dev`, unset
reads `dev` instead (see
[Importing production into a local database](#importing-production-into-a-local-database)).
A run is local when the stamp is null or matches. On QA, every other run is:

- invisible to the reaper, the scheduler, and `tf-runner`, which refuses to
  provision or destroy it (`runner/src/environment.ts`);
- read-only in the app: shown, with an "Imported from production" note, but
  Retry, Extend, End, Delete and editing all answer not found.

### When it goes wrong

| What happened | State | What to do |
| --- | --- | --- |
| Refused before the restore (runs holding resources, another execution running, the backup failed) | Nothing changed. The triggers resume. | Fix the cause and import again. |
| Failed after the restore, before the quarantine finished | **The triggers stay paused**, and the execution logs an ERROR saying so. The database may list production's runs unstamped. | Restore the pre-import backup from the Backups page, or stamp the runs with `update workshop_runs set environment = 'production'`, and then resume both triggers. |
| The finish step failed | Quarantined, so the triggers resume. Production's users may still hold production's roles, and production's credentials may still be in the tables. | Restore the pre-import backup. `SITE_ADMIN_EMAILS` users regain platform admin on sign-in, so one of them can always get to the page. |
| The execution hit the job's 3600s timeout | The `finally` never runs, so the triggers stay paused, whatever the stage. | Read the logs to see how far it got, then follow the row above that matches. |

Every import is logged by QA's app as a `component: "backups"` NOTICE:
`import_production` when it starts, with who started it and the execution
name, and `import_production_finished` with what the finish step did.

### Setting it up

Both halves are off by default. A person sets them, because each one is an
apply:

- **QA:** `production_backup_project` (and `production_backup_instance`, if
  it is not `workshops-db`) on `qa_control_plane`. That gives QA's runner-sa
  the custom role `workshopProductionImport` and tells the app where to look.
- **Production:** `backup_reader_members` on `admin_control_plane`, listing
  QA's `app-sa` and `runner-sa`. That grants them `roles/cloudsql.viewer` on
  production's project, which lists and reads backups and cannot restore over
  or connect to production's instance. It reaches production only through
  `deploy_production` with `run_infra=true`.

## Importing production into a local database

```bash
cd frontend && npm run db:import-production
```

This replaces the local database that `DATABASE_URL` in `frontend/.env` names
(normally `workshops`) with a copy of production's. The copy is cleaned up the
way QA's import cleans up. Use it to look at production's guides, events and
people on a laptop. Nothing in the local database survives it except your own
roles.

It differs from QA's import in three ways:

- **It dumps the live database instead of restoring a backup.** A Cloud SQL
  backup can only be restored onto a Cloud SQL instance. Exporting one needs
  a permission on production that nothing outside production holds.
- **There is no reaper to pause.** Nothing runs the reaper or the provisioner
  locally, and with `TF_RUNNER_JOB` unset the local app cannot start a runner
  execution.
- **There is no backup to undo it with.** Running it again is the way to get
  a fresh copy.

### What it does

`frontend/scripts/import-production.ts`, in order:

1. **Refuses** unless `DATABASE_URL` is the local container (not `:5433` or
   `6543`+), and unless the deployment reads as something other than
   production. When `DEPLOYMENT_ENVIRONMENT` is unset, the script uses `dev`.
2. **Takes a snapshot** of the local users who have any access.
3. **Dumps production.** It runs `pg_dump` through
   [`with-db.sh`](../scripts/with-db.sh), using `PROJECT=administration-459416`
   (`PRODUCTION_PROJECT` overrides it). `pg_dump` runs inside the local
   Postgres container, because the host has none and the container's major
   version matches production's. The container reaches the proxy as
   `host.docker.internal`.
4. **Restores** the dump into `<database>_import`, next to the local database.
5. **Runs QA's clean-up on the copy:** the same quarantine
   (`QUARANTINE_SQL` in `runner/src/import-policy.ts`), then the same finish
   step (`finishProductionImport`). Together they apply this branch's
   migrations, delete production's credentials, blank attendee passwords and
   give your roles back. It also writes a `local.import-production` audit row.
6. **Swaps it in:** it drops the local database (ending the dev server's
   connections) and renames the copy into its place.

Until step 6 the local database is untouched, so a failure earlier leaves it
as it was. The dump file is deleted either way. On 2026-10-03 the dump was
about 20 MB and the whole run took about ten seconds.

### What it needs

- `gcloud`, signed in to an identity that can read production's
  `database-url` secret, and `cloud-sql-proxy`, whose Application Default
  Credentials can connect to production's instance. A personal gcloud login
  on a Harness laptop needs a browser re-sign-in every day. When it lapses,
  the script stops before doing anything and shows gcloud's error. To avoid
  that, name a key-based gcloud configuration as
  `PRODUCTION_GCLOUD_CONFIGURATION` in `frontend/.env`. Only this script
  reads it. If the proxy's credentials lapse as well, set
  `GOOGLE_APPLICATION_CREDENTIALS` to a key file.
- The VPN off, since a TLS-inspecting VPN breaks the proxy
  ([operations.md](operations.md)).
- The local Postgres container running (`npm run db:up`).

### Afterwards

- **Sign in again.** The import clears every session. Your roles come from
  the snapshot, and `SITE_ADMIN_EMAILS` addresses regain platform admin on
  sign-in as usual.
- **Production's runs are read-only.** Every run is stamped `production`, and
  `next dev` reads its own environment as `dev` (`lib/deployment.ts`), so the
  app shows them as imported and refuses to change them. If you drive a runner
  module against this database by hand, set `DEPLOYMENT_ENVIRONMENT=dev`.
  The runner has no `next dev` fallback, so without it the runner treats
  production's runs as its own, with credentials for production's accounts.
- **Saved credentials are gone:** Harness tokens, org secrets, template
  sources and API tokens. Production's were deleted, and the local ones were
  in the database the import replaced. Add back any you need.

## Who can do what

| Action | Who | Enforced by |
| --- | --- | --- |
| Merge to `main` | Anyone with write access, through a PR that passes `verify` | GitHub ruleset `protect-main` |
| Push to `main` without a PR | Repository admins (Shawn) | Ruleset bypass list |
| Deploy QA | Anyone who can merge | The `deploy_qa_on_push_main` trigger |
| Run a Harness pipeline | Project group `orchestrator_developers` (Pipeline Executor + Project Viewer) | Harness RBAC |
| Deploy production | Anyone who can run `deploy_production` | Harness RBAC on the project |
| Read QA's logs, database and secrets | `developer_members` in `qa_control_plane` | GCP IAM on `harnessevents-qa` |
| Import a production backup into QA | Anyone who can manage backups on QA | `canManageBackups`, plus typing QA's instance name |
| Import production into a local database | Anyone who can read production's `database-url` secret and connect to its instance (Shawn, as of 2026-10-03) | GCP IAM on production's project |

**Where this is weaker than it looks.** These are the gaps as of 2026-09-30:

- **Nothing but Harness RBAC stands between a run and production.** The
  approval stage was removed on 2026-09-30. Harness account administrators
  (about 18 people) and anyone given Pipeline Executor on the project can run
  `deploy_production`, and so can release.
- **Group `300@harnessevents.io` holds `roles/owner` on production's GCP
  project.** Any member can deploy with `gcloud` directly and skip Harness
  altogether. Anyone added to that group has production access.
- Anyone with production's `terraform.tfvars` and a Harness PAT can apply
  `admin_control_plane` from a laptop (`scripts/backend-local.sh`).

## Setting QA up from nothing

This was done once, on 2026-09-29. It is recorded here so the steps can be
repeated.

1. `infra/admin/scripts/qa-bootstrap.sh`, run as tf-admin-sa. It creates the
   folders, the project, and `tf-admin-qa` with its key.
2. Create the Harness secret `gcp_tf_admin_qa_key` (file) and connector
   `gcp_tf_admin_qa`, then workspace `qa_control_plane`. It has the same
   repo/path/branch as production and the variables in the table above; the
   secret variables reuse the `tf_*` secrets.
3. First apply of `qa_control_plane`.
4. `qa-bootstrap.sh --grant-billing`, as tf-admin-sa. This grants QA's
   runner-sa `billing.user` and app-sa `billing.viewer`. `tf-admin-qa`
   cannot, because it lacks `billing.admin`, which is why QA sets
   `manage_billing_iam = false`.
5. Mint a key for `build-sa@harnessevents-qa`. Store it as the Harness secrets
   `gcp_qa_build_sa_key` (file) and `gcp_qa_build_sa_key_b64` (text, base64),
   and create connector `gcp_qa_build_sa`.
6. The domain mapping for `qa.harnessevents.io`. Cloud Run only maps a domain
   for an identity that is a **verified owner** of it in Search Console, and
   the only one is `admin@harnessevents.io`. That is who created production's
   mappings. tf-admin-sa is *not* an owner: a mapping it creates sits at
   `DomainRoutable=False / PermissionDenied` forever and holds the name.
   Either:
   - as admin@harnessevents.io in Search Console, add
     `tf-admin-qa@harnessevents-qa.iam.gserviceaccount.com` as an owner of
     `harnessevents.io`, then set `custom_domains = ["qa.harnessevents.io"]`
     on `qa_control_plane` so the mapping lives in code like production's; or
   - as admin@harnessevents.io, run `gcloud beta run domain-mappings create
     --service workshop-orchestrator --domain qa.harnessevents.io --region
     us-central1 --project harnessevents-qa`. It needs Cloud Run admin on
     `harnessevents-qa`; `group:300@harnessevents.io` has owner there.
7. Manual steps outside GCP and Harness:
   - DNS: the records the mapping asks for, which for `qa` are four `A`
     records (`216.239.32.21`, `.34.21`, `.36.21`, `.38.21`) and four `AAAA`
     records (`2001:4860:4802:32::15`, `34::15`, `36::15`, `38::15`), not a
     CNAME. `gcloud beta run domain-mappings describe` lists them.
   - OAuth client: add `https://qa.harnessevents.io/api/auth/callback/google`.
   - Workspace Admin console: create the OU `/QA`, and authorize QA
     runner-sa's numeric client id for domain-wide delegation with scopes
     `https://www.googleapis.com/auth/admin.directory.orgunit` and
     `https://www.googleapis.com/auth/admin.directory.user`.
8. The first `deploy_qa` run finds an empty database. It creates the schema
   with `drizzle-kit push` before applying the `.sql` migrations.
