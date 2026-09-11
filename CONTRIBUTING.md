# Contributing

This is the guide for getting a clone running on your laptop and for making a
change that reaches production safely.

It assumes the deployment **already exists** and you are joining it. If you are
standing up a brand-new Google Cloud org from scratch, that is a different and
much longer path — see [Initial setup](README.md#initial-setup) in the README.
You do not need any of it to develop locally.

---

## What you need before you start

Local development runs fully isolated from the deployment: its own Postgres in a
container, its own `.env`, localhost OAuth. Nothing you do locally touches the
deployed app or its data. So the access list is short:

| You need | For | Who grants it |
| --- | --- | --- |
| Push access to `suchcodewow/wsorchestrator` | Cloning and pushing | Repo admin |
| The Google OAuth client id + secret | Signing in locally | An existing dev — it is the deployed client, reused |

Everything else — GCP, AWS, Harness, Workspace credentials — is only needed to
run the *provisioning* side, which does not work locally anyway (see
[What does not work locally](#what-does-not-work-locally)). Skip it on day one.

## Tools on your PATH

- **Node 22 or newer.** Both Dockerfiles build on `node:22-slim`, so 22 is the
  version that matters; newer is fine locally.
- **Docker** — the local Postgres runs in a container via
  [docker-compose.yml](docker-compose.yml). Docker Desktop, Colima, or anything
  else that provides a Docker socket.
- **git**.

That is the whole list for local dev. `gcloud`, `tofu`/`terraform`, and
`cloud-sql-proxy` are only needed for deploying and for reaching the production
database — see [docs/operations.md](docs/operations.md) when you get there.

## Setup

```bash
git clone https://github.com/suchcodewow/wsorchestrator.git
cd wsorchestrator/frontend

npm install
cp .env.example .env
npx auth secret              # writes AUTH_SECRET into .env

npm run dev:setup            # starts Postgres + applies the schema  (FIRST RUN ONLY)
npm run dev                  # http://localhost:3000
```

Every `npm` command in this guide runs from `frontend/`. That is where the app's
`package.json`, `.env`, and Drizzle config live. The `runner/` package is
separate and has its own.

> **`npm run dev:setup` is a first-run command only.** It ends in
> `drizzle-kit push --force`, which diffs the schema onto the database and
> applies the result without asking. Against the empty database you just
> created that is exactly right. Against a database you have since put work
> into, `--force` will drop a column it thinks is no longer in the schema. Once
> you are set up, use `npm run dev` to start and `npm run db:up` to start just
> the container. To change the schema later, see
> [Changing the schema](#changing-the-schema).

### Filling in `.env`

[`.env.example`](frontend/.env.example) is heavily commented and the defaults
already point `DATABASE_URL` at the local container. Three things need your
attention:

- **`AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`** — ask another dev for the deployed
  OAuth client's values, and have them add
  `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI
  on that client. One client holds the production and localhost callbacks at
  once, so this does not disturb the deployment.
- **`AUTH_URL`** — already `http://localhost:3000`. If you run on another port,
  change it here too or sign-in redirects to the wrong place.
- **`SITE_ADMIN_EMAILS`** — optional. Set it to your own address to land as a
  site administrator on first sign-in, which is how you see the manager and
  administrator features. Your local database is its own, so whatever role you
  hold in the deployment does not carry over. See
  [Site roles](README.md#site-roles).

The rest of `.env.example` describes credentials for GCP, AWS, Azure, Harness,
and Workspace. Leave them at their placeholders. Each page that needs one says
"Not configured" rather than failing.

### Confirming it worked

Open http://localhost:3000, sign in with Google, and create an event on the
calendar. It will sit in `scheduled` forever, which is correct — see below.

---

## The two local databases

The container from [docker-compose.yml](docker-compose.yml) holds two:

| Database | What it is for |
| --- | --- |
| `workshops` | **Your real local work.** Long-lived, never recreated. Workshops and lab guides you author through your own dev server live here. |
| `workshops_agent` | **Scratch.** Carries the full schema and the baseline `harness_components` rows. Disposable — seed it, wreck it, reseed it. |

Point tests, seed scripts, and scratch experiments at `workshops_agent`:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/workshops_agent" npm run dev -- -p 3100
```

**Never run an unqualified `DELETE` or `TRUNCATE` against `workshops`.** It looks
like scratch space and is not. If a test genuinely has to use it, delete only the
rows by the ids that test created.

`psql` is not installed on the host. Reach either database through the
container:

```bash
docker exec workshoporchestrator-postgres-1 psql -U postgres -d workshops -c "select 1"
```

Note that the *published* workshops and lab guides — the ones attendees see —
live in Cloud SQL, not in your local `workshops`. Reading those is
[docs/operations.md](docs/operations.md#reaching-the-production-database).

---

## Changing the schema

Two mechanisms, and the distinction matters more here than in most projects:

- **`frontend/src/db/schema.ts`** is the Drizzle schema. `drizzle-kit push`
  diffs it onto a database. It knows *shape* only — it will drop a column whose
  data is still needed, and it cannot add a `NOT NULL` column to a table that
  already has rows.
- **`frontend/drizzle/NNNN_*.sql`** are hand-written, ordered, idempotent
  migrations applied by
  [`apply-sql.mjs`](frontend/scripts/apply-sql.mjs). Anything that has to *move*
  data lives here. Each wraps itself in a transaction and is written to be
  re-runnable.

The deploy pipeline runs the `.sql` files and **never** runs `db:push`, because
an unattended `push` is a data-loss risk. That gives one rule worth
internalising, already stated in [DEPLOY.md](DEPLOY.md#schema-changes):

> A change to `frontend/src/db/schema.ts` **must** be paired with a migration in
> `frontend/drizzle/`, or it will not reach production.

### Apply it locally in the same sitting

When you change `schema.ts` or add a `.sql` file, apply it to your local
`workshops` database before you stop for the day. Code that reads a column the
local database does not have fails at *runtime* — `npm run typecheck` passes
happily and you find out by hitting a broken page.

Prefer running your new migration, which is written to be safe to re-run, over
`push --force`:

```bash
docker exec -i workshoporchestrator-postgres-1 \
  psql -U postgres -d workshops < frontend/drizzle/00NN_your_migration.sql
```

To check whether the schema and the database have drifted, ask Drizzle for the
plan without letting it execute:

```bash
cd frontend && npx drizzle-kit push < /dev/null
```

`strict: true` in [drizzle.config.ts](frontend/drizzle.config.ts) makes it print
the statements it would run and then abort for lack of confirmation. A safe dry
run.

> **One permanent false positive** in that output:
> `ALTER TABLE "workshop_runs" ALTER COLUMN "clouds" SET DEFAULT '{}';`
> The database already has `'{}'::text[]`; drizzle-kit does not recognise the
> array cast and reports it forever. If that is the *only* statement, you are in
> sync.

### Migration numbering

Migrations are sequentially numbered (`0001_` … `0020_`). Two people working on
separate branches will both reach for the next number. Before you name a file,
check what is on `main` — and if you hit a collision at merge time, renumber
yours to come last rather than resolving the conflict in place.

---

## What does not work locally

Sign-in, the calendar, scheduling a workshop, run history, and the live run
views all work against the local database.

**Scheduled workshops never provision locally.** Nothing on your laptop plays
the part of the `tf-scheduler` cron, so a run stays in `scheduled` forever. That
is intended, not a bug you have hit: real provisioning creates Google Workspace
accounts, Harness organizations, and cloud projects, and belongs in the deployed
environment.

If you need to exercise the runner or a `server-only` library without deploying,
[TESTING.md](TESTING.md) has the techniques — they are faster than a deploy and
do not touch production.

---

## How your change ships

**A push to `main` deploys to production.** The `deploy_on_push_main` webhook
trigger runs the `deploy_workshop_orchestrator` Harness pipeline, which
typechecks and unit-tests the runner, applies infrastructure, builds both
images, runs the SQL migrations against Cloud SQL, and rolls Cloud Run. There is
no staging environment between your push and the app attendees use.

Before you push:

```bash
cd runner && npm run verify      # typecheck + unit tests — the same gate CI runs
cd frontend && npm run typecheck && npm run lint
```

`runner`'s unit suite is the corpus of every provider message a real run has
died on. It is worth reading [TESTING.md](TESTING.md) once to understand why it
exists — nearly every workshop failure to date was a pure function reading a
string and reaching the wrong conclusion.

To watch what your push did:

```bash
# The pipeline, in the Harness UI
open "https://app.harness.io/ng/account/8mh-FIIHQUapLuB6K0Cd-w/all/orgs/operations/projects/orchestrator/pipelines/deploy_workshop_orchestrator/executions"
```

To confirm what is actually live, open the app's user menu — the bottom line
shows the short SHA the running image was built from. Rolling back is
`make deploy TAG=<older-sha>`; see
[DEPLOY.md](DEPLOY.md#watching-and-rolling-back).

> **Environment variables do not ship this way.** The pipeline's infrastructure
> stage applies them, but a value that lives only in the git-ignored
> `infra/admin/terraform.tfvars` exists solely on the machine that applies. See
> [docs/operations.md](docs/operations.md).

---

## Working alongside other people

The project ran for its first 150 commits with a single developer pushing
straight to `main`. That worked because one person cannot conflict with
themselves. With more than one it needs a little structure:

- **Pull before you start.** `git pull --rebase` — the history is linear and
  rebasing keeps it that way.
- **Do not push work-in-progress to `main`.** Every push is a production
  deploy, including infrastructure and migrations. If you want to test the
  pipeline itself, run it manually from the Harness UI against your branch with
  `deploy=false` and `apply_infra=false` rather than committing a probe.
- **Two deploys running at once will fight.** They apply OpenTofu against the
  same IaCM workspace and migrate the same database. If someone else just
  pushed, let their run finish before you push.
- **Stage explicit paths, not `git add -A`.** More than one person — and more
  than one AI session — may have uncommitted work in a checkout at a time.

---

## Where the rest is written down

| Document | Covers |
| --- | --- |
| [README.md](README.md) | What the product does, architecture, and standing up a new deployment from nothing |
| [DEPLOY.md](DEPLOY.md) | The Makefile targets, the deploy pipeline, schema changes, rollback |
| [TESTING.md](TESTING.md) | Why the runner's tests exist, and how to exercise code locally without deploying |
| [docs/operations.md](docs/operations.md) | The deployed environment, its non-obvious quirks, reaching production data, and known outages |
| [docs/harness.md](docs/harness.md) | Harness API access, and the pipeline/trigger traps that cost a debugging round each |
| [infra/admin/README.md](infra/admin/README.md) | The control-plane Terraform and its IAM model |
| [runner/README.md](runner/README.md) | What a workshop run actually creates |
