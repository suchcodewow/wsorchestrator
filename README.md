# Workshop Orchestrator

Authenticated users pick a workshop from a library; the app provisions a
dedicated, **ephemeral Google Cloud environment** with Terraform and streams the
build results back. Each run gets its own GCP project and auto-destroys when its
TTL expires (1 hour by default).

## Stack

| Concern | Choice |
| --- | --- |
| Web UI | Next.js 15 (App Router) + React 19, Tailwind v4, shadcn/ui |
| Auth | Auth.js (NextAuth v5), Google provider, database sessions |
| Database | Postgres (Cloud SQL) via Drizzle ORM |
| Terraform runner | Cloud Run Job (`tf-runner`) |
| Reaper | Cloud Run Job (`tf-reaper`) on Cloud Scheduler |
| State | GCS bucket in the admin project, one prefix per run |

## Architecture

- **Admin project** (durable control plane): this app, Cloud SQL, the GCS state
  bucket, the runner/reaper jobs, and the `runner-sa` service account.
- **Workshop projects** (ephemeral): created per run under a dedicated GCP
  folder, hold the actual resources (GKE, Artifact Registry, …), no state.
- **`runner-sa`** is scoped at the **folder** level (broad inside workshops,
  sealed outside) plus `billing.user` on the billing account.

See the data model in [`src/db/schema.ts`](src/db/schema.ts) and the run
lifecycle in [`src/lib/runs.ts`](src/lib/runs.ts).

## Repository layout

| Path | What |
| --- | --- |
| [`src/`](src) | Next.js app (UI, auth, runs API) |
| [`infra/admin/`](infra/admin) | Terraform for the admin control plane |
| [`runner/`](runner) | `tf-runner`/`tf-reaper` container + workshop Terraform |
| [`Makefile`](Makefile), [`DEPLOY.md`](DEPLOY.md) | Deploy orchestration + runbook |

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
  (for running migrations/seed)
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

**IAM the operator (you) needs** — the identity running `terraform apply` must be
able to grant folder- and billing-level roles, not just build resources:

| Scope | Role | Why |
| --- | --- | --- |
| Admin project | `roles/owner` | Create bucket, Cloud SQL, secrets, Cloud Run, jobs |
| Workshops folder | `roles/resourcemanager.folderAdmin` | Grant `runner-sa` its folder roles |
| Billing account | `roles/billing.admin` | Grant `runner-sa` `billing.user` |

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
make bootstrap ADMIN_PROJECT=my-admin-project STATE_BUCKET=my-admin-project-infra-tfstate

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

## 5. Build images, deploy, migrate, seed

```bash
make ship
```

This builds the real app + runner images (Cloud Build), rolls Cloud Run onto
them, applies the database schema, and loads the sample workshops. It prints the
app URL when done.

## 6. Verify

Open `APP_URL`, sign in with Google, pick a workshop, and hit **Launch**. Watch
the run view stream Terraform output as it creates a project and resources; it
auto-destroys ~1 hour later (the reaper runs every 5 minutes).

**Done.** For day-to-day redeploys and rollbacks see [DEPLOY.md](DEPLOY.md).

---

## Local development

You can run the UI locally against a local Postgres (the launch flow needs the
deployed runner to actually provision, but sign-in, the library, and the run
views all work):

```bash
npm install
cp .env.example .env        # fill DATABASE_URL + Google OAuth (localhost client)
npx auth secret             # writes AUTH_SECRET

# start a local Postgres however you like, e.g.
# docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16

npm run db:push             # apply schema
npm run db:seed             # load sample workshops
npm run dev                 # http://localhost:3000
```

Make sure your OAuth client lists
`http://localhost:3000/api/auth/callback/google` as a redirect URI.

## Adding a workshop

1. Add a content module under
   [`runner/terraform/modules/`](runner/terraform/modules).
2. Add a root config under
   [`runner/terraform/workshops/<slug>/`](runner/terraform/workshops) wiring
   `modules/project` → your module.
3. Add a row to the `workshops` table (see [`src/db/seed.ts`](src/db/seed.ts))
   with `tf_source = "workshops/<slug>"`.

## Notes

- The Terraform is in a **testing posture**: `deletion_protection = false`, no DB
  backups, 1-hour TTL. Tighten these before anything real (see
  [infra/admin/README.md](infra/admin/README.md)).
- Applying the admin config requires org/folder/billing-level rights (step 0) —
  it grants IAM, not just resources.
