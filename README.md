# Workshop Orchestrator

Authenticated users schedule a workshop on a calendar — a name, how many
attendees, and which clouds are needed. At its start time the app provisions a
**Google Workspace organizational unit** named after the workshop, an account
per attendee inside it, and a dedicated **ephemeral cloud environment**, then
streams the build results back. Everything auto-destroys when the TTL expires
(1 hour by default).

Google Cloud is wired up today (an ephemeral project per workshop, via
Terraform); AWS and Azure can be selected but are not yet provisioned.

## Stack

| Concern          | Choice                                                     |
| ---------------- | ---------------------------------------------------------- |
| Web UI           | Next.js 15 (App Router) + React 19, Tailwind v4, shadcn/ui |
| Auth             | Auth.js (NextAuth v5), Google provider, database sessions  |
| Database         | Postgres (Cloud SQL) via Drizzle ORM                       |
| Terraform runner | Cloud Run Job (`tf-runner`)                                |
| Reaper           | Cloud Run Job (`tf-reaper`) on Cloud Scheduler             |
| State            | GCS bucket in the admin project, one prefix per run        |

## Architecture

- **Admin project** (durable control plane): this app, Cloud SQL, the GCS state
  bucket, the runner/reaper jobs, and the `runner-sa` service account.
- **Workshop projects** (ephemeral): created per run under a dedicated GCP
  folder, hold the actual resources (GKE, Artifact Registry, …), no state.
- **`runner-sa`** is scoped at the **folder** level (broad inside workshops,
  sealed outside) plus `billing.user` on the billing account.

See the data model in [`frontend/src/db/schema.ts`](frontend/src/db/schema.ts)
and the run lifecycle in [`frontend/src/lib/runs.ts`](frontend/src/lib/runs.ts).

## Repository layout

Each deployable lives in its own folder with its own `package.json`, Dockerfile,
and dependencies; the root holds only what ties them together.

| Path                                             | What                                                   |
| ------------------------------------------------ | ------------------------------------------------------ |
| [`frontend/`](frontend)                          | Next.js app — UI, auth, runs API, DB schema + migrations |
| [`runner/`](runner)                              | `tf-runner`/`tf-reaper` container + workshop Terraform |
| [`infra/admin/`](infra/admin)                    | Terraform for the admin control plane                  |
| [`scripts/`](scripts)                            | Deploy helpers (Cloud SQL proxy wrapper)               |
| [`Makefile`](Makefile), [`DEPLOY.md`](DEPLOY.md) | Deploy orchestration + runbook                         |

---

# Initial setup

This walks you from an empty Google Cloud org to a running, deployed app. Budget
~30–45 min the first time (Cloud SQL creation is the slow part).

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
- `node` 20+ and `git`

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
3. **Domain-wide delegation** for `runner-sa`. After `make infra` creates it,
   note its **client ID** (numeric, from the service account details) and in the
   Workspace admin console under **Security → API controls → Domain-wide
   delegation** authorize it for:
   ```
   https://www.googleapis.com/auth/admin.directory.orgunit
   https://www.googleapis.com/auth/admin.directory.user
   ```
   Then set `workspace_domain` and `workspace_admin_email` in
   `infra/admin/terraform.tfvars` and re-apply.

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
3. Leave the redirect URI for now — you'll add the deployed URL in step 4. (For
   local dev, add `http://localhost:3000/api/auth/callback/google`.)
4. Copy the **client ID** and **client secret** for the next step.

## 2. Configure Terraform variables

```bash
cd infra/admin
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`:

```hcl
admin_project_id    = "my-admin-project"
region              = "us-central1"
workshops_folder_id = "123456789012"          # from step 0.2
billing_account_id  = "XXXXXX-XXXXXX-XXXXXX"   # from step 0.3
tfstate_bucket      = "my-admin-project-ws-tfstate"

google_oauth_client_id     = "....apps.googleusercontent.com"   # from step 1
google_oauth_client_secret = "...."
```

> `terraform.tfvars` holds secrets and is git-ignored — never commit it.

## 3. Bootstrap state + stand up the control plane

From the repo root:

```bash
# Creates the bucket that stores THIS config's own state, then inits the backend.
make bootstrap ADMIN_PROJECT=administration-459416 STATE_BUCKET=events-tfstate

# Creates the bucket, Cloud SQL, service accounts + IAM, secrets, Artifact
# Registry, the app service, and the runner/reaper jobs.
# The app + runner run placeholder images on this first apply.
make infra
```

## 4. Point the OAuth client at the deployed app

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

## 5. Build images, deploy, migrate

```bash
make ship
```

This builds the real app + runner images (Cloud Build), rolls Cloud Run onto
them, and applies the database schema. It prints the app URL when done.

## 6. Verify

Open `APP_URL`, sign in with Google, and schedule a workshop — give it a name,
an attendee count, and tick **Google Cloud Platform**. Set the start time a few
minutes out; the scheduler picks it up within 5 minutes. Watch the run view
stream the OU and account creation, then the Terraform output as it creates the
project. It auto-destroys ~1 hour later (the reaper runs every 5 minutes).

**Done.** For day-to-day redeploys and rollbacks see [DEPLOY.md](DEPLOY.md).

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

### What works locally vs. not

Sign-in, the calendar, scheduling a workshop, run history, and the live run
views all work against the local DB. **Scheduled workshops never provision
locally**, though: nothing on your laptop plays the part of the `tf-scheduler`
cron, so a run stays in `scheduled`. That's intended — real provisioning creates
Workspace accounts and GCP projects and belongs in the deployed environment.

> Advanced: to exercise the runner locally, run it against your local
> `DATABASE_URL` with `gcloud` ADC, `terraform` (or `TF_BIN=tofu`), and the
> `GOOGLE_WORKSPACE_*` vars set:
> `RUN_ID=<uuid> npm start --prefix runner run`. Note the same VPN/TLS caveat as
> `cloud-sql-proxy` applies to its GCS state access.

## Adding a cloud

`aws` and `azure` are already accepted by the form and stored on the run; they
are logged as unimplemented at provisioning time. To wire one up:

1. Add a root config under
   [`runner/terraform/workshops/<cloud>-base/`](runner/terraform/workshops).
2. Handle the cloud in the loop in [`runner/src/run.ts`](runner/src/run.ts) and
   its teardown in [`runner/src/reap.ts`](runner/src/reap.ts).

## Notes

- The Terraform is in a **testing posture**: `deletion_protection = false`, no DB
  backups, 1-hour TTL. Tighten these before anything real (see
  [infra/admin/README.md](infra/admin/README.md)).
- Applying the admin config requires org/folder/billing-level rights (step 0) —
  it grants IAM, not just resources.
