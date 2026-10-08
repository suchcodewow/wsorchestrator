# Workshop Orchestrator

Authenticated users schedule a workshop on a calendar — a name, how many
attendees, and which clouds are needed. At its start time the app provisions a
**Google Workspace organizational unit** named after the workshop, an account
per attendee inside it, a **Harness organization** holding a project per
attendee, and a dedicated **ephemeral cloud environment**, then streams the
build results back. Everything auto-destroys when the TTL expires (1 day by
default, 3 at most, chosen when the event is created and extendable a day at a
time from the event's page).

All three clouds are provisioned via Terraform: Google Cloud gets an ephemeral
project per workshop, AWS a member account, and Azure a resource group — each
with a small Kubernetes cluster (GKE/EKS/AKS) and every attendee granted on it.
A workshop can select more than one; a challenge runs on exactly one and builds
a separate environment per competitor — bare by default, since standing up a
cluster is the challenge, unless the organizer ticks on a *scenario* that builds
one and breaks something about it
([runner/terraform/scenarios](runner/terraform/scenarios)). All three are part of every deployment:
credentials for each are configured up front (see
[infra/admin/variables.tf](infra/admin/variables.tf)), and a run that selects a
cloud whose credentials are missing fails its preflight rather than starting.

## Stack

| Concern           | Choice                                                          |
| ----------------- | --------------------------------------------------------------- |
| Web UI            | Next.js 16 (App Router) + React 19, Tailwind v4, shadcn/ui      |
| Auth              | Auth.js (NextAuth v5), Google provider, database sessions       |
| Database          | Postgres (Cloud SQL) via Drizzle ORM                            |
| Attendee accounts | Google Workspace — one OU per event, one account per attendee   |
| Harness           | One organization per event, one project per attendee            |
| Terraform runner  | Cloud Run Job (`tf-runner`)                                     |
| Scheduler         | Cloud Run Job (`tf-scheduler`) on Cloud Scheduler — starts runs whose start time has arrived |
| Reaper            | Cloud Run Job (`tf-reaper`) on Cloud Scheduler — destroys runs past their TTL |
| State             | GCS bucket in the admin project, one prefix per run             |

## Architecture

- **Admin project** (durable control plane): this app, Cloud SQL, the GCS state
  bucket, the runner/scheduler/reaper jobs, and the `runner-sa` service account.
- **Workshop projects** (ephemeral): created per run under a dedicated GCP
  folder, hold the actual resources (GKE, Artifact Registry, …), no state.
- **`runner-sa`** is scoped at the **folder** level (broad inside workshops,
  sealed outside) plus `billing.user` on the billing account.
- **Harness** is not per-project: one organization is created per event in a
  single long-lived Harness account, with a project per attendee. Each attendee
  administers their own project and can view the rest of the org. Projects are
  deleted before the org, which Harness requires.

See the data model in [`frontend/src/db/schema.ts`](frontend/src/db/schema.ts)
and the run lifecycle in [`frontend/src/lib/runs.ts`](frontend/src/lib/runs.ts).

## Repository layout

Each deployable lives in its own folder with its own `package.json`, Dockerfile,
and dependencies; the root holds only what ties them together.

| Path                                             | What                                                   |
| ------------------------------------------------ | ------------------------------------------------------ |
| [`frontend/`](frontend)                          | Next.js app — UI, auth, runs API, DB schema + migrations |
| [`runner/`](runner)                              | `tf-runner`/`tf-scheduler`/`tf-reaper` container + workshop Terraform |
| [`infra/admin/`](infra/admin)                    | Terraform for the admin control plane                  |
| [`scripts/`](scripts)                            | Deploy helpers (Cloud SQL proxy wrapper)               |
| [`docs/`](docs)                                  | The deployed environment, and Harness API/pipeline notes |
| [`Makefile`](Makefile), [`DEPLOY.md`](DEPLOY.md) | Deploy orchestration + runbook                         |

## Documentation

| Document | Read it when |
| --- | --- |
| [CONTRIBUTING.md](CONTRIBUTING.md) | **You are new.** Clone to running locally, changing the schema, how a change ships. |
| [Initial setup](#initial-setup) (below) | You are standing up a *new* deployment from an empty Google Cloud org. |
| [DEPLOY.md](DEPLOY.md) | Deploying, rolling back, or changing the schema in production. |
| [TESTING.md](TESTING.md) | Adding tests, or exercising code without deploying. |
| [docs/operations.md](docs/operations.md) | Something is broken in the deployed environment. |
| [docs/harness.md](docs/harness.md) | Touching the deploy pipeline, a trigger, or the Harness API. |
| [docs/api.md](docs/api.md) | Calling this site's API from a script with a personal access token. |

> **Joining an existing deployment?** You want
> [CONTRIBUTING.md](CONTRIBUTING.md), not the setup guide below. Local
> development needs Node, Docker, and an OAuth client — none of the cloud
> credentials.

---

# Initial setup

This walks you from an empty Google Cloud org to a running, deployed app. Budget
~30–45 min the first time (Cloud SQL creation is the slow part).

**Files you create.** Everything else in the repo is either committed or
generated — a fresh clone needs exactly one file to deploy:

| File                            | When                | Why it isn't in the repo                                              |
| ------------------------------- | ------------------- | --------------------------------------------------------------------- |
| `infra/admin/terraform.tfvars`  | Step 2, first apply only | Holds the Harness key and OAuth secret; `*.tfvars` is git-ignored. Once the IaCM workspace exists, its variables replace this file |
| `frontend/.env`                 | Local dev only      | The deployed app reads Secret Manager and Terraform-set env vars instead |

Terraform's own working directory (`infra/admin/.terraform/`, `.terraform.lock.hcl`)
is created by `make bootstrap` and is likewise git-ignored — don't hand-write it.

## 0. Prerequisites

**Tools on your PATH:**

- [`gcloud`](https://cloud.google.com/sdk/docs/install) — then authenticate for
  Terraform:
  ```bash
  gcloud auth login --update-adc   # one browser round-trip for both gcloud and ADC
  ```
  These are **user** credentials, and Workspace's Google Cloud session control
  reauth-challenges them (16h by default) — so a deploy started the day after a
  login fails with `Reauthentication failed`. After step 2 fills in
  `terraform.tfvars`, run `make tf-admin-sa` once to move deploys onto a
  service account key, which no session policy expires. See
  [infra/admin/README.md](infra/admin/README.md#operator-credentials).
- [`terraform`](https://developer.hashicorp.com/terraform/install) **or**
  [`tofu`](https://opentofu.org/docs/intro/install/) (the Makefile auto-detects
  which you have)
- [`cloud-sql-proxy`](https://cloud.google.com/sql/docs/postgres/sql-proxy) v2
  (for running migrations)
- `node` 22 (what both Dockerfiles build on) and `git`
- `docker` — only for local development, which runs Postgres in a container

**Google Cloud, before you start you need:**

1. **An organization** and an **admin project** (long-running) already created.
2. **A dedicated folder** for ephemeral workshops. Create one and note its
   **numeric ID**:
   ```bash
   gcloud resource-manager folders create \
     --display-name="workshops" --organization=<ORG_ID>
   gcloud resource-manager folders list --organization=<ORG_ID>   # copy the ID
   ```
3. **Your billing account ID** (`XXXXXX-XXXXXX-XXXXXX`):
   ```bash
   gcloud billing accounts list
   ```

**Google Workspace, before you start you need:**

1. A **Workspace domain** attendee accounts will be created in, with enough
   licences for your largest workshop.
2. A **super-admin** account for the runner to impersonate — the Admin SDK
   Directory API refuses service accounts acting as themselves.
3. **Domain-wide delegation** for `runner-sa` — but you cannot grant it yet, as
   the service account does not exist until the control plane is applied. That
   is [step 4](#4-authorize-the-runner-in-google-workspace). The domain and
   admin email themselves are needed earlier, in step 2: both are required
   variables, and the first apply stops without them.

**Harness, before you start you need:**

Every event becomes a Harness organization with a project per attendee, so this
is not optional — `harness_account_id` and `harness_api_key` have no defaults
and the first apply stops without them.

1. A **Harness account**. Its ID is the `account/<ID>` segment of any console
   URL (also under **Account Settings → Overview**).
2. An **API key** — a PAT or SAT with rights to create organizations and
   projects and to invite users. Terraform puts it in Secret Manager; only the
   runner jobs can read it.
3. On a non-SaaS or non-prod cluster, the **base URL** to talk to
   (`harness_base_url`, default `https://app.harness.io`). The built-in role and
   resource-group identifiers can be overridden too, but the defaults are right
   for a standard account — see the commented `HARNESS_*` block in
   [`frontend/.env.example`](frontend/.env.example).

**IAM the operator (you) needs** — the identity running `terraform apply` must be
able to grant folder- and billing-level roles, not just build resources:

| Scope            | Role                                | Why                                                |
| ---------------- | ----------------------------------- | -------------------------------------------------- |
| Admin project    | `roles/owner`                       | Create bucket, Cloud SQL, secrets, Cloud Run, jobs |
| Workshops folder | `roles/resourcemanager.folderAdmin` | Grant `runner-sa` its folder roles                 |
| Billing account  | `roles/billing.admin`               | Grant `runner-sa` `billing.user`                   |

## 1. Create the Google OAuth client

In the **admin project** → **APIs & Services → Credentials**:

1. Configure the **OAuth consent screen** (Internal is simplest for an org).
2. **Create Credentials → OAuth client ID → Web application**.
3. Leave the redirect URI for now — you'll add the deployed URL in step 5. (For
   local dev, add `http://localhost:3000/api/auth/callback/google`.)
4. Copy the **client ID** and **client secret** for the next step.

## 2. Configure Terraform variables

```bash
cd infra/admin
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`. **Every variable below is required** — none has a
default, and `make infra` stops and prompts for anything left out:

```hcl
admin_project_id    = "my-admin-project"
workshops_folder_id = "123456789012"           # from step 0.2
billing_account_id  = "XXXXXX-XXXXXX-XXXXXX"   # from step 0.3
tfstate_bucket      = "my-admin-project-ws-tfstate"   # per-run workshop state

# Google Workspace — where attendee accounts are created. Authorizing the
# runner against this domain is step 4; these two are needed now.
workspace_domain      = "example.com"
workspace_admin_email = "admin@example.com"    # a super-admin to impersonate

# Harness — one org per event, one project per attendee.
harness_account_id = "...."                    # from step 0, Harness #1
harness_api_key    = "pat...."                 # from step 0, Harness #2

google_oauth_client_id     = "....apps.googleusercontent.com"   # from step 1
google_oauth_client_secret = "...."
```

Worth setting now, though both have defaults:

```hcl
# Where the control plane runs. Workshops are built in `workshop_region`
# (default us-west1) instead — see infra/admin/terraform.tfvars.example.
region            = "us-central1"
# You, so you land as a platform administrator on first sign-in (see Site roles).
site_admin_emails = ["you@example.com"]
```

`app_url` is deliberately absent — it can only be filled in once the app
service exists, in step 5. Everything else is optional; see
[`terraform.tfvars.example`](infra/admin/terraform.tfvars.example) for the full
set, including custom domains and CI/CD.

> `terraform.tfvars` holds secrets and is git-ignored — never commit it. It is
> for this first apply only. Every value in it becomes a variable on the
> environment's Harness IaCM workspace, each secret as a `tf_*` Harness secret,
> and from then on the workspace is what deploys read. See
> [Where secrets and settings live](docs/environments.md#where-secrets-and-settings-live).

## 3. Bootstrap state + stand up the control plane

From the repo root:

```bash
# Enables the APIs this config needs before it can read anything.
make bootstrap ADMIN_PROJECT=my-admin-project

# Point the local CLI at the state the Harness IaCM workspace holds.
export TF_HTTP_PASSWORD=<harness PAT with Workspace Access State>
make backend-local

# Creates the workshop state bucket, Cloud SQL, service accounts + IAM, secrets,
# Artifact Registry, the app service, and the runner/scheduler/reaper jobs.
# The app + runner run placeholder images on this first apply.
make infra
```

> **Where this config's own state lives.** In the Harness IaCM workspace
> `admin_control_plane` (org `operations`, project `orchestrator`), not in GCS.
> That is why [`versions.tf`](infra/admin/versions.tf) has no backend block: the
> workspace injects one at init time, and a committed block would override it
> during pipeline runs and split the state in two. For hand-run plans,
> `make backend-local` writes the git-ignored `infra/admin/backend_local.tf`
> pointing at the same state.
>
> Don't confuse that with the `tfstate_bucket` variable: that bucket is
> created *by* the apply and holds per-run workshop state, one prefix per run.
>
> There used to be a third thing here, a GCS bucket holding this config's state
> that `bootstrap` created ahead of the first apply. Its contents were migrated
> into the workspace at serial 51 and the object was left behind, stale.

## 4. Authorize the runner in Google Workspace

`runner-sa` now exists, so the delegation deferred in step 0 can be granted. It
is what lets the runner create the per-event org unit and attendee accounts;
without it, provisioning fails at the first Admin SDK call.

Take `runner-sa`'s **client ID** — a numeric value, not its email. It is in the
Cloud console under **IAM & Admin → Service Accounts → runner-sa → Advanced
settings**, or:

```bash
make info    # copy PROJECT

gcloud iam service-accounts describe \
  runner-sa@<PROJECT>.iam.gserviceaccount.com \
  --project <PROJECT> --format='value(oauth2ClientId)'
```

Then in the **Workspace admin console → Security → Access and data control →
API controls → Domain-wide delegation → Add new**, paste that client ID and
authorize exactly these two scopes:

```
https://www.googleapis.com/auth/admin.directory.orgunit
https://www.googleapis.com/auth/admin.directory.user
```

The Directory API refuses a service account acting as itself, which is why
`workspace_admin_email` must name a real super-admin for it to impersonate.

## 5. Point the OAuth client at the deployed app

Now that the app service exists, get its URL and register the callback:

```bash
make info        # copy APP_URL
```

Back in **APIs & Services → Credentials → your OAuth client**, add an authorized
redirect URI:

```
<APP_URL>/api/auth/callback/google
```

Also set `app_url = "<APP_URL>"` on the IaCM workspace and apply, so Auth.js
pins `AUTH_URL`. Without it, host-guessing behind
Cloud Run can produce a `0.0.0.0:8080` redirect that Google rejects with a
"doesn't comply with OAuth 2.0 policy" error.

## 6. Build images, deploy, migrate

```bash
make ship
```

This builds the real app + runner images (Cloud Build), rolls Cloud Run onto
them, and applies the database schema. It prints the app URL when done.

## 7. Verify

Open `APP_URL` and sign in with Google. If your address is in
`site_admin_emails`, that first sign-in is what makes you a platform
administrator — the user menu should show the Platform Administrator badge, a **Show all events** switch, and
**Manage users** (see [Site roles](#site-roles)).

Then schedule a workshop — give it a name, an attendee count, and tick **Google
Cloud Platform**. Set the start time a few minutes out; the scheduler picks it
up within 5 minutes. Watch the run view stream the OU and account creation, then
the Terraform output as it creates the project. It auto-destroys a day later by
default (the reaper runs every 5 minutes and tears down whatever is past its TTL).

**Done.** For day-to-day redeploys and rollbacks see [DEPLOY.md](DEPLOY.md).

---

# Optional extras

Neither is needed to run the app; both are off by default.

## Serving on your own domain

Set `custom_domains` on the IaCM workspace and apply. Each hostname gets a
Cloud Run domain mapping and a managed TLS certificate:

```hcl
custom_domains = ["example.com", "www.example.com"]
app_url        = "https://example.com"   # the canonical one
```

Whichever host `app_url` names is canonical and the others 308-redirect to it —
not cosmetic, since Auth.js pins a single `AUTH_URL` and Google matches the
OAuth `redirect_uri` exactly, so sign-in only works on one origin. After
applying, add the records from the `domain_dns_records` output at your
registrar, and add `<domain>/api/auth/callback/google` to the OAuth client.

## Continuous deployment

There are two deployments, QA (https://qa.harnessevents.io) and production.
Each is its own apply of this module; [docs/environments.md](docs/environments.md)
maps them. A merge to `main` runs `deploy_qa`: it applies QA's infrastructure,
builds both images, applies the SQL migrations, and rolls QA's Cloud Run.
Production changes only when someone runs `deploy_production` by hand. That pipeline copies the images QA built
into production rather than rebuilding them. Both run in **Harness** (org
`operations`, project `orchestrator`), and each has these three stages:

1. **Infrastructure**, an IaCM stage against the environment's workspace:
   `qa_control_plane` or `admin_control_plane`. The workspace owns this
   module's state, its OpenTofu version, its variable values, and the GCP
   credential it plans as, so nothing has to be reconstructed per run. The apply step only runs when the plan reported
   changes, which for a code-only commit it will not.
2. **Build and migrate**, a CI stage. QA builds; production copies QA's images.
   Both images go to Artifact Registry, then the migrations run. Migrations run
   *before* the new image goes live — they only add columns with defaults, so
   the currently-running revision keeps working against the migrated schema,
   where the reverse order would serve a new image against a schema missing
   columns it reads on every request.
3. **Deploy**, a Harness CD stage of type Google Cloud Run. It rolls the
   service and points the runner jobs at the new image. On failure it routes
   traffic back to the revision that was serving. Terraform still owns the
   service's spec: the stage exports the live service and changes only the
   image. [DEPLOY.md](DEPLOY.md#cloud-run-deploys) explains why.

Three `deploy_qa` variables narrow a manual run: `run_infra=false` skips the
infrastructure stage, `apply_infra=false` plans without applying, `deploy=false`
builds and pushes without touching Cloud Run or the database.

This config's only remaining part in that is IAM: `enable_cicd = true` grants
build-sa what it needs beyond building (`run.admin`, `cloudsql.client`, `actAs`
on app-sa/runner-sa, accessor on `database-url`). Setting it false disables the
pipeline's deploy and migrate steps by removing their permissions. There is no
GitHub wiring to do here — Harness holds its own repo connector, and the
`github_*` variables are vestigial. See [`cicd.tf`](infra/admin/cicd.tf) and
[DEPLOY.md](DEPLOY.md).

> Cloud Build used to run this, from [`cloudbuild.yaml`](cloudbuild.yaml) with
> `_DEPLOY=true`. Its trigger, GitHub App connection, repository link and PAT
> grant were deleted at the cutover, because leaving them would have meant two
> systems racing to deploy the same commit. The file stays at the repo root
> because `make images` still submits it for a manual build-and-push.

---

## Local development

> The fuller version of this section, with the database rules, the schema-change
> workflow, and how a change reaches production, is
> [CONTRIBUTING.md](CONTRIBUTING.md). What follows is the short form.

Local dev runs fully **isolated** from the Google deployment: its own Postgres
(a local container, never prod Cloud SQL), its own `.env`, and localhost OAuth.
The two coexist — nothing you do locally touches the deployed app or its data.

```bash
cd frontend
npm install
npm run dev:setup            # .env, Postgres, both local databases; safe to re-run
npm run dev                  # http://localhost:3000
```

`dev:setup` creates `.env` from `.env.example` with a generated `AUTH_SECRET`,
starts the local Postgres from [docker-compose.yml](docker-compose.yml)
(`npm run db:up` / `db:down` to control it on its own), and gives each empty
local database the schema and the `.sql` migrations. It leaves a database that
already has tables alone. On later runs, just `npm run dev`.

All of the `npm` commands above run from `frontend/` — that's where the app's
`package.json`, `.env`, and Drizzle config live.

**Edit `.env`** — the defaults already point `DATABASE_URL` at the local
container. You just need:

- `AUTH_URL="http://localhost:3000"` (already set)
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — reuse the deployed OAuth client, and
  add a redirect URI to it:
  `http://localhost:3000/api/auth/callback/google`
  (a client can hold both the prod and localhost callbacks at once).
- `SITE_ADMIN_EMAILS` — optional, but set it to your own address if you want to
  see every area's administrator features locally. The local database is its
  own, so the role you hold in the deployment does not carry over. See
  [Site roles](#site-roles).

### What works locally vs. not

Sign-in, the calendar, scheduling a workshop, run history, and the live run
views all work against the local DB. **Scheduled workshops never provision
locally**, though: nothing on your laptop plays the part of the `tf-scheduler`
cron, so a run stays in `scheduled`. That's intended — real provisioning creates
Workspace accounts and GCP projects and belongs in the deployed environment.

> Advanced: to exercise the runner locally, run it against your local
> `DATABASE_URL` with `gcloud` ADC, `terraform` (or `TF_BIN=tofu`), and the
> `GOOGLE_WORKSPACE_*` and `HARNESS_*` vars set — the runner requires
> `HARNESS_ACCOUNT_ID` and `HARNESS_API_KEY` and exits without them:
> `RUN_ID=<uuid> npm start --prefix runner run`. Note the same VPN/TLS caveat as
> `cloud-sql-proxy` applies to its GCS state access. This creates **real**
> Workspace accounts, Harness orgs, and GCP projects — it is not a dry run.

## Site roles

The site is divided into functional areas, and every user holds a role in each
one separately. An area's administrators set everyone's role in that area and
no other.

**Events** — the orchestrator, lab guides and components. Cumulative: each
role does everything the one before it does.

| Role                    | Adds                                                            |
| ----------------------- | --------------------------------------------------------------- |
| **No event access**     | Nothing. What everyone starts as.                               |
| **Event Contributor**   | Writes Harness components but cannot run events.                |
| **Event Operator**      | Schedules and runs their own events.                            |
| **Event Manager**       | A **Show all events** switch that flips the calendar to every user's events, and can open and delete any of them. Also writes the [workshops and lab guides](#workshops-and-lab-guides). |
| **Event Administrator** | Sets everyone's event role on **Manage users**; **Event Settings** (org secrets, templates, GitHub repos); and **Cloud Status**. |

**Scheduler** — a placeholder for now.

| Role                        | Adds                                                        |
| --------------------------- | ----------------------------------------------------------- |
| *(none)*                    | Nothing. What everyone starts as.                           |
| **Scheduler Viewer**        | The **Scheduler** page.                                     |
| **Scheduler Administrator** | Sets everyone's scheduler role on **Manage users**, and **Scheduler settings**. |

**Assessments** — eVals is one part of it; the same roles as the scheduler. The **eVals** page is still a
placeholder; **eVals settings** holds what it will draw on:

- **Google Meetings**: meetings with a title, a start, a length (15m, 30m or
  1 hour) and the Current-tab groups they invite (Bootcamp Sales, Bootcamp
  Engineers, Intermediate Sales, Intermediate Engineers). Saving one sends
  nothing. **Sync Now** creates or updates each upcoming meeting's Google
  Calendar invite, as the Google account an Assessments Administrator
  connected on the tab. Each invite goes to its groups and to every
  Assessments Administrator. It carries a Zoom link whose alternative hosts
  are those administrators. The invites sit on an "eVals Meetings" calendar
  the sync makes on that account and shares with the administrators, so they
  can edit them and the cohort cannot. Setting it up is in
  [docs/operations.md](docs/operations.md#google-meetings).
- **HiBob**: syncs HiBob's active employees into the `employees` table, replacing
  the previous sync, every day at 3:00 AM Eastern and whenever **Sync HiBob
  Now** is pressed. Every run, scheduled or manual, is logged on the tab with
  its count or error. The service user comes from the deployment, not the page:
  `hibob_userid` and `hibob_token` on the IaCM workspace (the token as the
  Harness secret `tf_hibob_token`), which reach Cloud Run
  as `HIBOB_SERVICE_USER_ID` and `HIBOB_TOKEN`. Cloud Scheduler job
  `hibob-sync-trigger` calls `/api/evals/hibob/sync/scheduled` with an OIDC
  token for the scheduler service account; nothing else gets past that route.
  Below the log, the tab lists everyone whose reporting line reaches
  `carlos.delatorre@harness.io`, with each person's list and bootcamp dates.
- **Employees**: the whole `employees` table, searchable and sortable by any
  column.
- **Automatic Sales Titles**, **Automatic Engineer Titles** and **Ignored
  Titles**: the job titles that put someone on each list. Each title can be on
  only one list, and case doesn't matter.
- **Attendee Tracking**: bootcamp (BTC) and INT history, one row per email.
  This table replaced the `Bootcamp_History` sheet and is the record now, so
  people are added and edited here. An **Exempt** switch stores the sheet's
  `2000-01-01` marker. The old sheet can still be uploaded: rows are matched
  by email and only the file's own columns are written.

| Role                          | Adds                                                            |
| ----------------------------- | --------------------------------------------------------------- |
| *(none)*                      | Nothing. What everyone starts as.                               |
| **Assessments Viewer**        | The **eVals** page.                                             |
| **Assessments Administrator** | Sets everyone's Assessments role on **Manage users**, and **eVals settings**, including **Google Meetings**. |

**Iris** — adaptive placement tests for new GTM hires: eight subjects, each
taken once per form, which place someone Beginner, Intermediate or Advanced so
enablement can route their training. Takers never see their own level.
Independent of eVals: an Assessments role gives no Iris access, and the reverse.

| Role                     | Adds                                                            |
| ------------------------ | --------------------------------------------------------------- |
| *(none)*                 | Nothing. What everyone starts as.                               |
| **Iris Taker**           | The **Iris** page: takes the tests.                             |
| **Iris Administrator**   | Sets everyone's Iris role on **Manage users**; everyone's results and the answer key; approves and rejects questions. |

**Platform Administrator** is a flag rather than a role in an area. It counts
as administrator in every area, and adds what reaches past any single one:
[who may sign in at all](#restricting-sign-in) on **Admin Settings**, the [**Backups**](#backups)
page — restoring rolls back every area at once — the **Database** console, and
making other people platform administrators. Only a platform administrator can
change another platform administrator's roles.

The first platform administrator has to come from outside the app: any address
in `SITE_ADMIN_EMAILS` (`site_admin_emails` on the IaCM workspace,
comma-separated in `.env` locally) is made one when it signs in, and again on
every sign-in after — so the flag can't be removed from those addresses in the
app, and the page refuses to try. Nobody can change their own roles — that
takes a second administrator, so a mis-click can't leave the site with nobody
able to hand them back.

Deleting an event that owns live accounts and cloud projects does not drop the
record on the spot: the run is expired immediately and flagged, the reaper
tears down Workspace accounts, the org unit, and the cloud resources on its
next tick, and the event disappears when that finishes. An event that hasn't
provisioned yet, or that has already been torn down, is deleted outright. One
mid-provision can't be deleted until it settles — the teardown needs to know
what exists.

The rules live in [`frontend/src/lib/roles.ts`](frontend/src/lib/roles.ts) and
are enforced server-side on every read and write; the menu only decides what is
worth showing.

**Reporting → Canary Wire** is granted by HiBob, not a role: anyone the last
HiBob sync has reporting to them sees it, as do platform administrators. It
is read on every request, so a reorg reaches it with the next sync. A manager
opens on their own org — themselves and everyone under them, every level down —
and an **Everyone** switch shows the whole Canary Wire; for someone with no one
reporting to them it is shown greyed out, on everyone. **Canary Wire History**,
beside it, shows each rep's share of their lineup finished month by month over
the last six months, under the same scope. **Refresh now**, which
pulls Mindtickle by hand rather than waiting for the two-hourly pull, is for
platform administrators.

## Restricting sign-in

By default anyone with a Google account can sign in, arriving with no access to
any area until an administrator grants a role. To limit
that to your own organization, a platform administrator adds the domains you
allow under **Admin Settings**.

The list lives in the database (`allowed_email_domains`), so changing it is a
page and not a redeploy. Domains can be added, edited, and removed there, each
with an optional note saying why it is on the list. An address whose domain
isn't listed is refused at the Google callback, before any user row or session
is written — it doesn't become a signed-out account waiting for approval, it
simply isn't created. The visitor lands back on the sign-in page with a reason.

**An empty list means no restriction.** That is the state a fresh deployment is
in, and deleting the last domain returns it there rather than shutting everyone
out.

### The bootstrap, and not locking yourself out

Three things keep the page from being a foot-gun:

- **You can't save a change that would shut you out.** Adding the first domain
  is the dangerous one — until then everyone is allowed, and the moment a list
  exists everyone outside it is not. A change leaving the administrator making
  it unable to sign in is refused, whether it's an add, an edit, or a delete.
- **`SITE_ADMIN_EMAILS` addresses are always allowed**, whatever their domain.
  The same list that bootstraps the first administrator is the way back in.
- **`AUTH_ALLOWED_EMAIL_DOMAINS` still works and is always in force**, unioned
  with the table. Set it as the `allowed_email_domains` variable on the IaCM
  workspace (a list, such as `["example.com"]`), or in `frontend/.env` locally. These appear on the settings page as locked
  rows: in force, but changed in the deployment's configuration rather than in
  the app. Nothing is copied from it into the table — two editable copies of
  one rule would only drift apart.

If the table is ever wrong and nobody can get in, set `site_admin_emails` (or
`allowed_email_domains`) on the IaCM workspace and apply. That is what the
environment is for.

**With exactly one domain in force**, the sign-in page asks Google for it (the
`hd` parameter), so the account chooser offers Workspace accounts on that
domain rather than letting someone pick a personal account and be turned away
after. That's a hint in a URL the visitor controls, not the check — the check
is server-side in [`frontend/src/auth.ts`](frontend/src/auth.ts) either way,
against the value Google signs and returns.

**Existing users are not affected retroactively.** The check runs at sign-in,
so someone from a now-disallowed domain can't get back in once their session
expires, but a live session keeps working and their user row stays. To cut
them off now, delete the row — sessions cascade with it:

```sql
DELETE FROM users WHERE email NOT LIKE '%@example.com';
```

Attendee pages (`/attend/...`) are public and unaffected by any of this:
attendees open a link and never sign in to this app.

## Backups

Cloud SQL takes a **daily automated backup** of the instance and keeps seven,
alongside **point-in-time recovery** over the same window. Both are configured
in [`infra/admin/database.tf`](infra/admin/database.tf) and tuned by
`db_backup_start_time` (UTC, default 03:00) and `db_backup_retention_days`
(default 7). They were off until this was added — apply the Terraform before
relying on them.

PITR is the more useful half and is not in the UI: an automated backup only
takes you back to 03:00, while PITR replays the write-ahead log, so a table
dropped at 14:32 can be recovered to 14:31. That is a `gcloud sql instances
clone --point-in-time` operation.

`/backups` is a **platform-administrator-only** page listing the history, with how old
the last good backup is — the question it is usually opened to answer — plus a
**Back up now** button and a restore.

**Restoring is destructive and in place.** It replaces the entire instance, not
the lab tables you probably opened the page for, so the confirmation dialog
spells out what that means and requires the instance name typed by hand:

- The app is offline for the length of the restore.
- Every session is rolled back, so whoever pressed the button is signed out.
- Site roles revert to what they were at that moment.
- **Events provisioned since the backup are stranded.** Their rows vanish while
  their GCP projects, Workspace accounts, and Harness organizations keep
  running, and the reaper only tears down what it has a row for. The dialog
  lists those events by name and id before you confirm, and the same list is
  written to Cloud Logging — not to a table, which the restore would erase.

Press **Back up now** first. Rolling back to 03:00 discards everything since,
and an on-demand backup taken a minute earlier is the only way back from that.

The app's service account holds `roles/cloudsql.editor` for this — enough to
restore an instance, not to delete one. The queries are in
[`frontend/src/lib/backups.ts`](frontend/src/lib/backups.ts).

> **Not covered:** `deletion_protection` on the instance is still `false`, so a
> `terraform destroy` would take the database with it. Flip it on in
> `database.tf` for anything you cannot retype.

## Workshops and lab guides

`/labs` holds the teaching material: the written instructions an attendee
follows during a session. It is **public** — the room reads it signed out, the
same way `/attend` works — and a **manager** or above writes it.

Two things, deliberately separate:

- A **lab guide** is one document — one Markdown body, one URL, one thing to
  edit. "Authenticate to Google Cloud" is a lab guide.
- A **workshop** is an ordered list of guides. It owns the sequence and nothing
  else; the guides in it are references, not copies.

The split is what makes the material reusable. The same authentication lab opens
the onboarding workshop and the security one, in different positions, and fixing
a typo in it fixes both. Neither is attached to a scheduled event: a
`workshop_run` lives for an hour and is reaped, while this outlives every room
that works through it.

| | |
| --- | --- |
| Workshops | `/labs`, `/labs/<workshop>` — anyone, no account |
| Reading a lab | `/labs/<workshop>/<guide>` — with step number, contents rail, and prev/next |
| A lab on its own | `/labs/guides/<guide>` — its canonical home, and how a guide in no workshop is reached |
| Workshop editor | `/labs/new`, `/labs/<workshop>/edit` — manager and above |
| Guide editor | `/labs/guides/new`, `/labs/guides/<guide>/edit` — manager and above |
| Drafts | Visible only to those who could edit them; a 404 for everyone else |
| Storage | `lab_workshops`, `lab_workshop_guides` (the ordering), `lab_guides` (the Markdown) |

**Composing a workshop.** The editor holds the contents as an ordered list —
add from a searchable picker, nudge up or down, remove — and sends the whole
order in one save rather than a request per gesture. Removing a guide from a
workshop does not delete it; deleting a *workshop* leaves every guide it used
intact. Deleting a *guide* takes it out of every workshop that used it, which is
why the guide editor says which ones those are before you do.

**Reading before choosing.** Every guide in the contents list and in the picker
carries an eye icon that opens it in a modal, rendered exactly as the room will
see it — Shiki highlighting, copy buttons and all. The body is fetched on the
click that needs it (`GET /api/lab-guides/<id>/preview`) rather than shipped
with the page: a workshop can hold fifty guides of up to 200 KB of Markdown
each. Close it with the button, the overlay, or Escape.

**Writing a guide you are missing.** The picker's *Write a new guide* action
saves the workshop first — including an order you have been rearranging and have
not saved yet — then opens the guide editor with that workshop in tow. Saving
the guide appends it to the workshop and returns you to it; leaving without
saving costs only the guide. This is the one write that adds to a workshop
without being handed its whole order, and it has its own endpoint
(`POST /api/lab-workshops/<id>/guides`) because the guide editor knows what it
just created and nothing about what else is in the workshop.

**Draft guides inside a published workshop** are hidden from anyone who could
not edit them, and skipped when computing "next" — so a reader is never counted
into a step they cannot open, and never offered a link to one.

**Authoring.** GitHub-flavoured Markdown — tables, task lists, footnotes.
Raw HTML in the source is dropped rather than rendered, and the author's tree is
sanitised, so a guide cannot inject script into a public page. Fence code with
its language for highlighting, and optionally name the file:

````markdown
```hcl title="main.tf"
resource "google_container_cluster" "lab" { … }
```
````

Blocks are rendered with [Shiki](https://shiki.style) against both colour
schemes at once, and carry a copy button for the whole block plus a line gutter
where each number copies its own line. All of it is rendered on the server —
neither the Markdown parser nor any syntax grammar reaches the browser.

**Callouts** are triple-colon blocks, with an optional title on the opening line:

```markdown
:::tip stop and smell the code!
Everything on this page is generated from the pipeline you just ran.
:::
```

The kinds are `note`, `tip`, `success`, `warning` and `danger`, each with its own
icon and accent; `info`/`important`, `warn`, `check` and `caution`/`error` are
aliases of those. Without a title the kind's name is used. `:::details Show the
answer` folds its body away until it is wanted — add `{open}` to start it
unfolded — and anything else after the colons is left as the literal text you
typed, so a stray `:::foo` reads as a mistake instead of vanishing. Callouts nest
inside a numbered step if you indent them under it.

**Where you are in a guide.** The rail beside the prose follows the reading
position: a bar slides to whichever heading you last read past, and that heading
is the one lit. It is measured against a line just under the sticky header, not
against visibility — on a screenful of short sections several headings are
visible at once, and inside a long one none are. The last section is usually
shorter than a screen, so once the page runs out of scroll the rail marks it even
though its heading never reached the line. This is the one part of a guide that
has to run in the browser
([`guide-contents.tsx`](frontend/src/app/labs/guide-contents.tsx)); the list
itself comes from the server with the page.

**The URL.** Slugs — for both a workshop and a guide — are derived from the
title and freeze the moment the thing is published: the address is by then on a
projector and in browser histories, and renaming to fix a typo would break every
link handed out. Retitling a published workshop or guide is fine; only a draft's
slug follows its title.

The pipeline is [`frontend/src/lib/markdown.ts`](frontend/src/lib/markdown.ts);
the queries are in [`frontend/src/lib/lab-guides.ts`](frontend/src/lib/lab-guides.ts)
and [`frontend/src/lib/lab-workshops.ts`](frontend/src/lib/lab-workshops.ts).

## Adding a cloud

`gcp`, `aws`, and `azure` are all wired up. A fourth would follow the same
shape:

1. Add it to `CLOUDS` in [`frontend/src/db/schema.ts`](frontend/src/db/schema.ts),
   which is what the pickers and the run's `clouds` column read.
2. Add root configs under
   [`runner/terraform/workshops/<cloud>-base/`](runner/terraform/workshops) and
   [`runner/terraform/challenges/<cloud>-per-user/`](runner/terraform/challenges),
   plus a cluster module under
   [`runner/terraform/modules/`](runner/terraform/modules) if the workshop root
   builds one. Scenarios are separate and optional — see
   [`runner/terraform/scenarios/README.md`](runner/terraform/scenarios/README.md).
3. Add a tfvars writer in
   [`runner/src/workspace.ts`](runner/src/workspace.ts) and the cloud's config
   accessor in [`runner/src/config.ts`](runner/src/config.ts).
4. Handle the cloud in the loop in [`runner/src/run.ts`](runner/src/run.ts) and
   its teardown in [`runner/src/reap.ts`](runner/src/reap.ts). Non-GCP clouds
   namespace their state with `cloudStatePrefix`, so a multi-cloud run's states
   never collide.
5. Pass its credentials through
   [`infra/admin/runner.tf`](infra/admin/runner.tf), gated on a variable so a
   deployment that does not use it applies unchanged.

## Notes

- The Terraform is in a **testing posture**: `deletion_protection = false`, no DB
  backups, 1-hour TTL. Tighten these before anything real (see
  [infra/admin/README.md](infra/admin/README.md)).
- Applying the admin config requires org/folder/billing-level rights (step 0) —
  it grants IAM, not just resources.
