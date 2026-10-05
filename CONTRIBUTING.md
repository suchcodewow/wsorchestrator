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
npm run dev:setup            # .env, Postgres, both local databases; safe to re-run
npm run dev                  # http://localhost:3000

cd ../runner && npm install  # only if you will touch the runner
```

Every `npm` command in this guide runs from `frontend/` unless it says
otherwise. That is where the app's `package.json`, `.env`, and Drizzle config
live. The `runner/` package is separate and has its own.

`npm run dev:setup` takes a few seconds and does everything the database side
needs:

1. Creates `frontend/.env` from `.env.example` if it is missing, and replaces the
   `AUTH_SECRET` placeholder with a generated secret.
2. Starts the Postgres container from [docker-compose.yml](docker-compose.yml).
3. Creates [both local databases](#the-two-local-databases), `workshops` and
   `workshops_agent`. Each one that is empty gets the schema
   (`drizzle-kit push`) and then the hand-written `.sql` migrations, which add
   rows a fresh database needs, such as the baseline `harness_components`. That
   is the same order `deploy_qa` uses on an empty Cloud SQL database.

A database that already has tables is left alone, so running it again is always
safe; it never runs `push --force` against your work. To bring an existing
database up to date, see [Changing the schema](#changing-the-schema). Day to
day, `npm run dev` starts the app and `npm run db:up` starts just the container.

`npm install` warns that install scripts for `esbuild`, `fsevents` and
`unrs-resolver` are "not yet covered by allowScripts". That is npm 11 being
cautious. Nothing here needs those scripts, so the warning is safe to ignore.

The container publishes Postgres on port 5432. If another Postgres already
listens there (a Homebrew one, say), stop it first.

### Filling in `.env`

[`.env.example`](frontend/.env.example) is heavily commented and the defaults
already point `DATABASE_URL` at the local container, and `dev:setup` has written
`AUTH_SECRET`. Three things need your attention:

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

You do not need the OAuth values to start contributing. Every test suite runs
without them, and without any other credential:

```bash
npm run verify                        # typecheck + lint + unit tests, ~10s
npm run test:db                       # role rules against workshops_agent, ~5s
npm run build && npm run test:e2e     # every persona against every route, ~20s
cd ../runner && npm run verify        # runner typecheck + unit tests, ~4s
```

If those pass on a fresh clone, your setup is complete.

---

## The two local databases

The container from [docker-compose.yml](docker-compose.yml) holds two, both
created by `npm run dev:setup`:

| Database | What it is for |
| --- | --- |
| `workshops` | **Your real local work.** Long-lived, never recreated. Workshops and lab guides you author through your own dev server live here. `npm run db:import-production` replaces it with production's data instead ([how](docs/environments.md#importing-production-into-a-local-database)). |
| `workshops_agent` | **Scratch.** Carries the full schema and the baseline `harness_components` rows. Disposable — seed it, wreck it, reseed it. |

Point tests, seed scripts, and scratch experiments at `workshops_agent`:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/workshops_agent" npm run dev -- -p 3100
```

To start `workshops_agent` over, drop it and run setup again. It is recreated
from the schema and migrations in a few seconds:

```bash
docker exec workshoporchestrator-postgres-1 psql -U postgres -c "drop database workshops_agent"
npm run dev:setup
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

> **Two permanent false positives** in that output:
> `ALTER TABLE "workshop_runs" ALTER COLUMN "clouds" SET DEFAULT '{}';` and the
> same for `"scenarios"`. The database already has `'{}'::text[]`; drizzle-kit
> does not recognise the array cast and reports it forever. If those are the
> *only* statements, you are in sync.

### Migration numbering

Migrations are sequentially numbered (`0001_`, `0002_`, …). Two people working on
separate branches will both reach for the next number. Before you name a file,
check what is on `main` — and if you hit a collision at merge time, renumber
yours to come last rather than resolving the conflict in place.

---

## Adding a feature

Every feature meets three requirements. The unit suite enforces the first two,
so a change that misses either fails `npm run verify`.

### It can be reached through the API

Anything a person can see or do in the UI, a script holding a personal access
token can see or do through the API.

- **A page that shows data needs a `GET` that returns the same data.** The page
  and the route call the same `src/lib` function. Neither has its own query.
- **Every route goes through `requireCaller`**
  ([`api-auth.ts`](frontend/src/lib/api-auth.ts)), so a token works on it as
  well as a session. Call `auth()` directly only for the session-only kinds in
  [docs/api.md](docs/api.md#session-only-routes).
- **Every route has an entry in
  [`src/lib/api-reference/`](frontend/src/lib/api-reference/)**, which is
  published at `/api`. Describe what the handler actually does: its parameters,
  its response, and every error it can return.
- **Every route has an entry in the e2e matrix** in
  `frontend/test/e2e/roles.test.ts`, giving the role it needs. A session-only
  route is marked `sessionOnly`.
- Add the page to the table in
  [docs/api.md](docs/api.md#what-a-page-shows-and-where-to-read-it).

### It leaves an audit trail

Every action is recorded in `audit_events`. Administrators read it on
**Administration → Audit Trail**, or through `GET /api/audit`.

- **Wrap every `POST`, `PATCH`, `PUT` and `DELETE` handler in `audited`**
  ([`audit.ts`](frontend/src/lib/audit.ts)):

  ```ts
  export const POST = audited(async function POST(req: Request) { … });
  ```

  The wrapper records the caller, whether they came by session or token, the
  route, the request body with secrets redacted, and the outcome. A 403 is
  recorded as `denied` and any other status of 400 or above as `failed`. It
  does not record a 401, because a caller nobody could identify has nothing to
  attribute.
- **Name what the action changed with `noteAudit({ target, targetLabel })`**
  once the handler knows it. `target` is the id and `targetLabel` the name a
  person recognises. "Deleted lab guide *Intro to CD*" is useful to someone
  reading the trail. "DELETE /api/lab-guides/8f3c…" is not.
- **A `POST` that changes nothing** (a preview, a validation, a search) is not
  audited. Mark its api-reference entry `changesNothing: true` instead of
  leaving the handler unwrapped. The coverage test in
  `test/unit/audit.test.ts` checks every mutating handler for one or the other.
- **An action that does not come through a route** (sign-in, a scheduled job,
  anything the runner does) calls `recordAudit` itself. When no person did it,
  pass `actor: null` and an `actorName` from `SYSTEM_ACTORS`. The runner uses `recordRunAudit` in
  [`runner/src/db.ts`](runner/src/db.ts).

### Its tables read 100 rows at a time

A table backed by the database never loads everything and filters in the
browser. Searching, sorting and paging all happen in the query, and each query
returns at most `PAGE_SIZE` (100) rows.

1. **Add a `ListSpec`** to [`list-specs.ts`](frontend/src/lib/list-specs.ts),
   listing the columns the table can sort by (the first is the default) and the
   default direction. This file must stay free of server-only imports, because
   the API reference that runs in the browser reads it.
2. **Write the list function** in `src/lib`. It takes a
   `ListQuery<YourSort>` and returns a `Page<Row>`, built from
   [`paging.ts`](frontend/src/lib/paging.ts) and
   [`paging-sql.ts`](frontend/src/lib/paging-sql.ts):

   ```ts
   const { limit, offset } = pageWindow(query.page);   // LIMIT 101: one row past the page
   const rows = await db.select().from(t)
     .where(searchAny(query.q, [t.name, t.email]))      // ILIKE, wildcards escaped
     .orderBy(...orderFor(SORT_COLUMNS[query.sort], query.dir, t.id))  // nulls last, stable
     .limit(limit).offset(offset);
   return toPage(rows, query.page);                     // { rows, page, hasMore }
   ```

   Always give `orderFor` a unique column (usually `id`) to break ties last.
   Without one, a row can appear on two pages, or on neither.
3. **Have the page and the `GET` both use `parseListQuery(params, YOUR_LIST)`.**
   The page reads its `searchParams` and the route reads its URL. Both take the
   same `q`, `sort`, `dir` and `page`. In the api-reference entry, spread
   `listQuery(...)` into `query` and `PAGE_FIELDS` into the response.
4. **Build the table from
   [`data-table.tsx`](frontend/src/components/data-table.tsx)**:
   `TableSearch`, a `SortHeader` per sortable column (a `PlainHeader` for the
   others), and a `Pager` under the table. They write to the URL, and the
   server component re-runs the query.
5. **When a page has several tables**, give each a prefix such as `"sales"`.
   Its sort and page then live under `sales.sort` and `sales.page`, and every
   table on the page shares one search box (`q`).
6. **A total for the heading** ("1,204 employees") comes from a separate
   `count(*)`. Do not count the page's rows for it.

A list with a small hard limit enforced when rows are written (template sources
stop at `MAX_TEMPLATE_SOURCES` per owner) does not need paging. Neither does a
list that does not come from the database.

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
                                                  deploy_production (by hand) → production
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

**Production is a separate release, started by hand.** `deploy_production`
takes a commit QA has already built (by default whatever QA runs right now) and
copies that exact image into production, so production never runs a build QA
didn't. There is no approval stage: once preflight passes, the run releases.
Leave starting it to Shawn.

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

> **A new variable's value does not ship in the PR.** The apply reads every
> value from the environment's IaCM workspace in Harness, and a secret from a
> `tf_*` Harness secret. Add it there before merging. See
> [Where secrets and settings live](docs/environments.md#where-secrets-and-settings-live).

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
  database holds, against accounts shared with production. The one exception is
  the import on QA's Backups page, which quarantines what it brings. See
  [docs/environments.md](docs/environments.md#never-copy-production-data-into-qa-except-by-importing-a-backup).

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
