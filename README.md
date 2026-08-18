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
a separate environment per competitor. All three are part of every deployment:
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
| [`Makefile`](Makefile), [`DEPLOY.md`](DEPLOY.md) | Deploy orchestration + runbook                         |

---

# Initial setup

This walks you from an empty Google Cloud org to a running, deployed app. Budget
~30–45 min the first time (Cloud SQL creation is the slow part).

**Files you create.** Everything else in the repo is either committed or
generated — a fresh clone needs exactly one file to deploy:

| File                            | When                | Why it isn't in the repo                                              |
| ------------------------------- | ------------------- | --------------------------------------------------------------------- |
| `infra/admin/terraform.tfvars`  | Step 2 — **required** | Holds the Harness key and OAuth secret; `*.tfvars` is git-ignored     |
| `frontend/.env`                 | Local dev only      | The deployed app reads Secret Manager and Terraform-set env vars instead |

Terraform's own working directory (`infra/admin/.terraform/`, `.terraform.lock.hcl`)
is created by `make bootstrap` and is likewise git-ignored — don't hand-write it.

## 0. Prerequisites

**Tools on your PATH:**

- [`gcloud`](https://cloud.google.com/sdk/docs/install) — then authenticate for
  Terraform:
  ```bash
  gcloud auth login
  gcloud auth application-default login
  ```
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
# You, so you land as a site administrator on first sign-in (see Site roles).
site_admin_emails = ["you@example.com"]
```

`app_url` is deliberately absent — it can only be filled in once the app
service exists, in step 5. Everything else is optional; see
[`terraform.tfvars.example`](infra/admin/terraform.tfvars.example) for the full
set, including custom domains and CI/CD.

> `terraform.tfvars` holds secrets and is git-ignored — never commit it.

## 3. Bootstrap state + stand up the control plane

From the repo root:

```bash
# Creates the bucket that stores THIS config's own state, then inits the backend.
make bootstrap ADMIN_PROJECT=my-admin-project STATE_BUCKET=my-admin-infra-tfstate

# Creates the workshop state bucket, Cloud SQL, service accounts + IAM, secrets,
# Artifact Registry, the app service, and the runner/scheduler/reaper jobs.
# The app + runner run placeholder images on this first apply.
make infra
```

> **Two different buckets, and they are easy to confuse.**
> `STATE_BUCKET` above holds the state of *this Terraform config itself* — it
> must exist before the first apply, which is the whole reason `bootstrap`
> exists. `tfstate_bucket` in `terraform.tfvars` is created *by* the apply and
> holds per-run workshop state, one prefix per run. Give them clearly different
> names.
>
> `STATE_BUCKET` is not recorded in any file: the backend block in
> [`versions.tf`](infra/admin/versions.tf) is bare, and the value is passed to
> `terraform init` by [`bootstrap.sh`](infra/admin/scripts/bootstrap.sh). If you
> ever re-clone this repo, bootstrap with the **same** bucket name or Terraform
> will start from empty state and try to build a second copy of everything.

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

Also set `app_url = "<APP_URL>"` in `infra/admin/terraform.tfvars` and re-apply
(`make infra`) so Auth.js pins `AUTH_URL`. Without it, host-guessing behind
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
`site_admin_emails`, that first sign-in is what makes you an administrator —
the user menu should show the role badge, a **Show all events** switch, and
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

Set `custom_domains` in `terraform.tfvars` and re-apply. Each hostname gets a
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

With `enable_cicd = true`, a push to `main` builds both images, applies the SQL
migrations, and rolls Cloud Run — the same [`cloudbuild.yaml`](cloudbuild.yaml)
`make images` uses, with `_DEPLOY=true`. Two things must be done by hand first,
because Terraform cannot do either:

1. Install the [Cloud Build GitHub App](https://github.com/apps/google-cloud-build)
   on the repo, and take the installation ID from the URL it redirects to
   (`.../installations/<ID>`).
2. Store a classic PAT (scopes: `repo`, `read:user`) in Secret Manager:
   ```bash
   printf '%s' <TOKEN> | gcloud secrets create github-pat \
     --data-file=- --project <ADMIN_PROJECT>
   ```

Then set `enable_cicd`, `github_owner`, `github_repo`,
`github_app_installation_id`, and `github_pat_secret_id` (the secret's **name**,
`github-pat` — not the token) and re-apply. Details in
[`cicd.tf`](infra/admin/cicd.tf) and [DEPLOY.md](DEPLOY.md).

---

## Local development

Local dev runs fully **isolated** from the Google deployment: its own Postgres
(a local container, never prod Cloud SQL), its own `.env`, and localhost OAuth.
The two coexist — nothing you do locally touches the deployed app or its data.

```bash
cd frontend
npm install
cp .env.example .env         # then edit (see below)
npx auth secret              # writes AUTH_SECRET into .env

npm run dev:setup            # docker compose up + db:push
npm run dev                  # http://localhost:3000
```

`dev:setup` starts the local Postgres from [docker-compose.yml](docker-compose.yml)
(`npm run db:up` / `db:down` to control it on its own) and applies the schema.
On later runs, just `npm run dev`.

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
  see the manager and administrator features locally. The local database is its
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

Every signed-in user has one of three roles. They are cumulative — each does
everything the one before it does:

| Role              | Adds                                                            |
| ----------------- | --------------------------------------------------------------- |
| **operator**      | Schedules and runs their own events. What everyone starts as.   |
| **manager**       | A **Show all events** switch in the user menu that flips the calendar to every user's events, and can open and delete any of them. Also writes the [workshops and lab guides](#workshops-and-lab-guides). |
| **administrator** | A **Manage users** page listing everyone, where roles are set, and the [**Backups**](#backups) page — including restoring the database. |

Roles are granted by an administrator, so the first one has to come from
outside the app: any address in `SITE_ADMIN_EMAILS` (`site_admin_emails` in
`terraform.tfvars`, comma-separated in `.env` locally) is made an administrator
when it signs in. Once someone holds the role they can promote the rest, and
the setting can be emptied. An administrator cannot change their own role —
that takes a second administrator, so a mis-click can't leave the site with
nobody able to hand it back.

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

`/backups` is an **administrator-only** page listing the history, with how old
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
   builds one.
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
