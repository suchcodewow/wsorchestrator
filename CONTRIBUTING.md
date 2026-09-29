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
  platform administrator on first sign-in, which is how you see every area's
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

```
branch → pull request → verify → merge to main → deploy_qa → QA
                                                  deploy_production (approved) → production
```

**Work on a branch and open a pull request.** `main` is protected by the
GitHub ruleset `protect-main`: changes arrive by PR, and the `verify` Harness
pipeline has to pass on it. That pipeline typechecks, lints and unit-tests the
runner and the frontend. It needs no credentials and touches nothing deployed.

**Merging deploys QA, at https://qa.harnessevents.io.** The
`deploy_qa_on_push_main` trigger runs `deploy_qa`. That pipeline verifies
again, applies the `qa_control_plane` workspace, builds both images into QA's
registry, runs the SQL migrations against QA's Cloud SQL, and rolls QA's Cloud
Run. The QA header carries an amber **qa** badge, so the two are hard to
confuse. QA has its own GCP project and database. It shares the Harness,
AWS, Azure and Google Workspace accounts with production, so a workshop you
run there creates real things. Prefer runs with no cloud, or GCP only.
[docs/environments.md](docs/environments.md) has the full map.

**Production is a separate, approved release.** `deploy_production` takes a
commit QA has already built (by default whatever QA runs right now) and copies
that exact image into production, so production never runs a build QA didn't.
Anyone may start the pipeline. Every run then stops at an approval that only
the `prod_deployers` group (Shawn) can pass. The approval message shows the
commit, what production runs now, and a GitHub compare link between them.

Before you open the PR:

```bash
cd runner && npm run verify      # typecheck + unit tests — the same gate CI runs
cd frontend && npm run verify    # typecheck + lint + unit tests — also run by CI
cd frontend && npm run test:db   # role rules against workshops_agent — local only
```

If you changed who may see or do something, also build and run the role
matrix: `npm run build && npm run test:e2e`. [TESTING.md](TESTING.md#the-frontends-suites)
describes all three suites.

`runner`'s unit suite is the corpus of every provider message a real run has
died on. It is worth reading [TESTING.md](TESTING.md) once to understand why it
exists — nearly every workshop failure to date was a pure function reading a
string and reaching the wrong conclusion.

To watch what your merge did:

```bash
open "https://app.harness.io/ng/account/8mh-FIIHQUapLuB6K0Cd-w/all/orgs/operations/projects/orchestrator/pipelines/deploy_qa/executions"
```

To confirm what is actually live, open the app's user menu: its bottom line
shows the short SHA the running image was built from. Rolling production back
means running `deploy_production` with `sha=<older-sha>` and
`allow_rollback=true`; see [DEPLOY.md](DEPLOY.md#watching-and-rolling-back).

**Migrations must be additive.** Migrations run before the new image rolls, so
the old image runs briefly against the new schema. A rollback also runs an old
image against the new schema, because migrations are never reverted. Add
columns and tables; do not rename or drop one that code still in production
reads. Do that in a later change, once nothing reads it.

**Infrastructure changes reach production separately.** A `.tf` change applies
to QA on merge. It reaches production only when `deploy_production` runs with
`run_infra=true`. IaCM applies the head of `main`, not the commit being
promoted, so preflight refuses that combination when the two differ in
`infra/admin/*.tf`.

> **Environment variables do not ship this way.** The pipeline's infrastructure
> stage applies them, but a value that lives only in the git-ignored
> `infra/admin/terraform.tfvars` exists solely on the machine that applies. See
> [docs/operations.md](docs/operations.md).

---

## Working alongside other people

Three people, and their AI sessions, work on this now. What keeps that sane:

- **One branch per change, rebased on `main`.** `git pull --rebase` before you
  start and again before you merge. The history is kept linear.
- **Keep PRs small and merge them soon.** Every merge is a QA deploy, and QA is
  where the others check their own work. A branch that sits for a week collides
  with someone's schema change.
- **Merges queue; they do not fight.** `deploy_qa` and `deploy_production`
  each begin with a Queue step, so a second run waits for the first to finish.
- **Tell the others before a schema or infrastructure change merges.** It
  changes QA for everyone at once.
- **Stage explicit paths, not `git add -A`.** More than one person — and more
  than one AI session — may have uncommitted work in a checkout at a time.
- **Do not copy production data into QA.** QA's reaper acts on whatever rows its
  database holds, against accounts shared with production. See
  [docs/environments.md](docs/environments.md#never-copy-production-data-into-qa).

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
