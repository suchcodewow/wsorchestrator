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
| Terraform runner | Cloud Run Job (`tf-runner`) — _step #3_ |
| Reaper | Cloud Run Job (`tf-reaper`) on Cloud Scheduler — _step #3_ |
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

## Local development

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL, AUTH_*, GCP_* values
npx auth secret             # writes AUTH_SECRET

# start a local Postgres however you like, e.g.
# docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16

npm run db:push             # apply schema
npm run db:seed             # load sample workshops
npm run dev                 # http://localhost:3000
```

### Google OAuth

Create OAuth 2.0 credentials in the admin project's **APIs & Services →
Credentials**, with redirect URI `http://localhost:3000/api/auth/callback/google`
(and your prod URL). Put the client id/secret in `AUTH_GOOGLE_ID` /
`AUTH_GOOGLE_SECRET`.

## What's implemented (step #1)

- Google sign-in, database-backed sessions, protected `(app)` routes.
- Workshop library grid + "Launch" flow.
- `POST /api/runs`, `GET /api/runs`, `GET /api/runs/:id` with ownership checks.
- Live run view that polls status + streamed logs and renders Terraform outputs.

## Not yet wired (steps #2–#3)

- Admin-project Terraform (bucket, Cloud SQL, service accounts, IAM, jobs).
- The `tf-runner` / `tf-reaper` container and its entrypoint logic
  (`triggerRunnerJob` in `src/lib/runs.ts` is currently a stub).
