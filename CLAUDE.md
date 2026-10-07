# Working in this repo

Guidance for AI coding agents. Humans: [CONTRIBUTING.md](CONTRIBUTING.md) is the
one to read.

## Getting a working checkout

`frontend/` is the Next.js app and owns the database schema; `runner/` is the
Cloud Run job that provisions workshops; `infra/admin/` is the control-plane
Terraform. From a fresh clone:

```bash
cd frontend && npm install && npm run dev:setup   # .env, Postgres, both local databases
cd ../runner && npm install
```

`dev:setup` is safe to re-run: it creates what is missing and leaves any
database that already has tables alone. After it, every check under
[Before saying you are done](#before-saying-you-are-done) passes with **no
credentials at all**. If one fails on an untouched checkout, the setup is
wrong, not the code; say so rather than working around it.

What a contributor's machine usually does _not_ have: Google OAuth values in
`.env`, `infra/admin/terraform.tfvars` (which holds the Harness PAT), and
gcloud access to production. Without OAuth you cannot sign in through the
browser; to see a signed-in page, use the session-row technique in
[TESTING.md](TESTING.md#a-screenshot-of-a-signed-in-page). Anything in
`docs/harness.md` or `docs/operations.md` that needs the others is for someone
who holds them. Say what you need and stop; do not look for a credential
elsewhere.

Before investigating a failure in the deployed app, read
[Known issues](docs/operations.md#known-issues). Several things that look broken
are expected or were deliberately left alone.

## Guardrails

These are the mistakes that have actually been made here, each of which
destroyed work or broke something live.

**The local `workshops` database is not scratch space.** It holds real authored
workshops and lab guides. Use **`workshops_agent`** for anything you seed,
mutate, or clean up. Never run an unqualified `DELETE` or `TRUNCATE` against
`workshops`; if a test must touch it, delete only rows by the ids that test
created.
`npm run db:import-production` replaces `workshops` with production's data
and reads production to do it; run it only when the user asks.

**Verify which database you are on rather than inferring it from `lsof`.** On a
Colima machine the local Postgres shows up as an `ssh` process on `:5432` — that
is the VM's port-forward, not a foreign tunnel. A `cloud-sql-proxy` on `:5433`
or `6543`+ is **production**. Confirm with a query:

```bash
node -e "const pg=require('pg');(async()=>{const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();console.log((await c.query('select current_database(), inet_server_port()')).rows);await c.end();})()"
```

**Never kill a process you did not start.** Port 3000 is usually a developer's
own dev server. A port collision is not evidence the process is yours. Start
test servers elsewhere: `npm run dev -- -p 3100`.

**Other sessions share this working tree.** Another agent — or a person — may
have uncommitted edits in the same checkout. So:

- Run `git status --short` before reverting anything.
- Stage **explicit paths**. Never `git add -A`.
- Never `git checkout -- <dir>` on a shared path; uncommitted work is not
  recoverable from the reflog.
- If a file holds both your change and someone else's, leave it out of your
  commit and say so in the message.

**A worktree you create gets its own database before anything runs in it.**
Every checkout pointed at `workshops` shares one schema, so a branch's
migrations would reach every other checkout's server, and theirs yours. After
`git worktree add` (or `EnterWorktree`), and before `npm run dev`, a test, or
anything else that reads `DATABASE_URL`:

```bash
cd <worktree>/frontend && npm install && npm run db:worktree
```

It copies the main checkout's `.env` and database into `workshops_wt_<branch>`,
repoints the worktree's `.env`, and applies the branch's migrations; see
[Working in a git worktree](CONTRIBUTING.md#working-in-a-git-worktree). Never
point a worktree at `workshops` itself. When you remove a worktree you made,
run `npm run db:worktree:drop` in it first; it drops only `workshops_wt_*`.
The copy is disposable: nothing in it is merged back, so tell the user before
they author anything there they mean to keep.

**Work on a branch and open a pull request. Never push to `main`.** A merge to
`main` deploys QA (https://qa.harnessevents.io): it applies `qa_control_plane`,
migrates QA's Cloud SQL, and rolls QA's Cloud Run. The GitHub ruleset lets
repository admins bypass the PR requirement, and the credentials on this
machine may belong to one. That bypass is for the owner, not for you. Push a
branch, run `gh pr create`, and stop there unless the user says to merge.

**Production is released by a person, not by you.** `deploy_production` copies
the image QA built into production. It has no approval stage, so **starting it
is releasing**: once preflight passes it migrates production's database and
rolls production's Cloud Run. Do not start `deploy_production` unless the user
asks you to in so many words. The Harness PAT on this machine is the owner's
own, so a run you start is recorded as theirs. Do not change the ruleset or
who can run `deploy_production` either. The full flow is in
[docs/environments.md](docs/environments.md).

**QA is not a sandbox either.** It shares the Harness account, the AWS
organization, the Azure subscription and the Google Workspace with production.
A QA workshop run creates real orgs, accounts and users. Prefer runs with no
cloud, or GCP only. **Never copy production data into QA's database.** QA's
reaper would then tear down production's live workshops, because the accounts
are shared. The only exception is the import on QA's Backups page, which a
person starts; do not start one yourself, and do not restore a production
backup into QA any other way.

**Do not run a deploy pipeline to test something.** Run `verify` on your branch,
or `deploy_qa` by hand with `deploy=false` and `apply_infra=false`. Each deploy
pipeline has a Queue step, so a second run waits rather than fighting the
first over the same OpenTofu workspace and database.

# Codebase Merging & Integrity Rules

- NEVER overwrite, delete, or drastically refactor existing architectural patterns, helper functions, or utility classes unless explicitly directed. Always search the codebase for existing implementations before writing new logic.
- COMPLIANCE: All new code additions must exactly adhere to the established design patterns, linter configurations, and file structuring already present in the repository.
- TEST PRESERVATION: You must verify that existing unit tests still pass before modifying any file. If code changes alter an existing implementation, update the associated test file instead of bypassing it.
- REDUNDANCY CHECK: Before introducing new dependencies or large helper files, cross-reference existing modules to see if the capability already exists.

## Conventions

**Use Tailwind v4's canonical utility names, not the v3 aliases.**
`frontend` is on `tailwindcss: ^4.0.0`, which renamed several utilities and
kept the old ones only as deprecated aliases (`break-words` →
`wrap-break-word`, `flex-shrink-*` → `shrink-*`, `flex-grow-*` → `grow-*`,
`overflow-ellipsis` → `text-ellipsis`). Write the v4 name in new or edited
JSX; don't reintroduce the alias just because it still compiles.

**A `schema.ts` change must be applied to the local database in the same
turn.** Code reading a column the local database lacks fails at _runtime_;
`npm run typecheck` passes and the developer finds out by hitting a broken page.
`npm run dev` applies every migration to the local container before it starts,
but a server that is already running does not. Run the new
`frontend/drizzle/*.sql` (they are written to be re-runnable) rather than
`drizzle-kit push --force`, which drops things.

**A `schema.ts` change must also be paired with a migration in
`frontend/drizzle/`**, or it never reaches QA or production — the pipelines run
the `.sql` files and never `db:push`. Name it
`$(date -u +%Y%m%d%H%M%S)_what_it_does.sql`, never the next number after
`0063_`; `test/unit/migrations.test.ts` enforces it, and why is in
[Naming a migration](CONTRIBUTING.md#naming-a-migration).

**The Harness pipelines are stored inline and mirrored in
`infra/admin/pipelines/`** (`verify.yml`, `deploy-qa.yml`,
`deploy-production.yml`). Update Harness and the mirror in the same change, or
the change either does not run or is invisible to review. Editing
`deploy-production.yml` is a production change: say so in the PR.

**`infra/admin` serves both environments.** Anything environment-specific is a
variable. Production's value is the default; QA's is set on `qa_control_plane`.
Never hard-code `administration-459416` or `harnessevents.io` in a new
resource. A `.tf` change reaches QA on merge but reaches production only when
`deploy_production` runs with `run_infra=true`.

**Every feature meets three requirements**, set out in
[CONTRIBUTING.md](CONTRIBUTING.md#adding-a-feature):

- It can be reached through the API.
- Every action it adds writes an audit record.
- Every table it adds fetches at most 100 rows per query.

In practice:

- Wrap each `POST`, `PATCH`, `PUT` and `DELETE` handler in `audited`
  (`frontend/src/lib/audit.ts`) and name its target with `noteAudit`. Actions
  outside a route call `recordAudit`, or `recordRunAudit` in the runner.
- Back each table with a `ListSpec` in `frontend/src/lib/list-specs.ts`, a list
  function built from `paging.ts` and `paging-sql.ts`, and the controls in
  `frontend/src/components/data-table.tsx`.
- Never load every row and filter or sort it in the browser. Neither the
  unit suite nor review catches that, so it falls to you.

**A new API route goes through `requireCaller`** (`frontend/src/lib/api-auth.ts`)
so that a personal access token works on it as well as a session. Call `auth()`
directly only for the session-only kinds listed in [docs/api.md](docs/api.md),
and mark those `sessionOnly` in the e2e matrix. A page that shows data needs a
`GET` that returns the same data. Every route also needs an entry in
`frontend/src/lib/api-reference/`, which is published at `/api`. The unit suite
fails until that entry exists, so describe the handler as it actually behaves.

**A heading's subtitle must earn its place with a live value.** A `<p>` under
an `<h1>`/`<h2>`/`<h3>` stays only if it leads with or consists of something
that changes at runtime — a count, a timestamp, a configured value, a name.
Prose that only explains what the page is or how it works, with nothing live
in it, gets deleted rather than written in the first place; don't reach for a
subtitle to restate what the heading and the surrounding controls already
make obvious. `frontend/src/app/(app)/cohort-settings/employees/employees-table.tsx`
("N active employees, as of the HiBob sync on {date}") is the shape to copy;
a page like the old `frontend/src/app/(app)/settings/layout.tsx` ("Configuration
for running events, visible only to administrators.") is the shape to avoid.

**Group related items in one card with separators, not a stack of cards.**
A run of checks, settings or steps that belong together goes in a single
bordered card whose rows are split by `divide-y`, each row padded on its own
(`px-5 py-4`). Don't give each item its own `rounded-2xl border` card with
`space-y-*` between them: the gaps and repeated borders spread one task across
the page. `frontend/src/app/(app)/me/check-pc/check-pc-view.tsx` is the shape
to copy. Separate cards are for things that really are separate, such as a
status banner above the list.

**A table row that opens something is clickable across its whole width.**
If a row's name links to a detail page or opens an edit dialog, a click
anywhere on the row must do the same, not just on the name. Give the `<tr>`
`LINK_ROW` and `onClick={rowLink(href)}` from `useRowLink`
(`frontend/src/components/data-table.tsx`); pass a function instead of an href
for a dialog. Keep the `<Link>` in the first cell for keyboard and
middle-click, styled `group-hover:underline`. Buttons, checkboxes and other
links in the row keep their own behaviour without any extra work.
`frontend/src/app/(app)/scheduler/scheduler-view.tsx` is the shape to copy.

## Before saying you are done

```bash
cd runner    && npm run verify              # typecheck + unit tests, the CI gate
cd frontend  && npm run verify              # typecheck + lint + unit tests, also the CI gate
cd frontend  && npm run test:db             # role rules, against workshops_agent
```

If you touched a role, a `can*` check, or the gate on a page or route, also run
`npm run build && npm run test:e2e` in `frontend/`. It starts the standalone
server on :3100 and checks every persona against every page and route; add
any new route to its matrix.

`runner`'s unit suite is the corpus of provider messages that real runs have
died on. If you touch a classifier in `runner/src/classify.ts` or
`destroy-policy.ts`, add the string that motivated the change as a fixture —
[TESTING.md](TESTING.md) explains why that file exists.

Prefer verifying behaviour over asserting it. [TESTING.md](TESTING.md) has three
techniques that beat deploying: driving a runner module with `tsx`, running a
`server-only` lib with `--conditions=react-server`, and screenshotting a
signed-in page.

`psql` is not on the host PATH:

```bash
docker exec workshoporchestrator-postgres-1 psql -U postgres -d workshops_agent -c "..."
```

## Where things are written down

| Document                                     | Covers                                                                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [CONTRIBUTING.md](CONTRIBUTING.md)           | Clone to running locally; schema changes; how a change ships                                                                           |
| [docs/environments.md](docs/environments.md) | QA vs production: what is separate, what is shared, who can release; where secrets and settings live (Harness, not `terraform.tfvars`) |
| [README.md](README.md)                       | What the product does, architecture, standing up a new deployment                                                                      |
| [DEPLOY.md](DEPLOY.md)                       | Makefile targets, the deploy pipeline, rollback                                                                                        |
| [TESTING.md](TESTING.md)                     | Why the runner's tests exist; exercising code without deploying                                                                        |
| [docs/operations.md](docs/operations.md)     | The deployed environment, its quirks, production data, known issues                                                                    |
| [docs/harness.md](docs/harness.md)           | Harness API access and the pipeline/trigger traps                                                                                      |
| [docs/evals-port.md](docs/evals-port.md)     | Every feature of the eVals Google Sheet and whether it is ported, partial, or still to decide; update a row when you port one          |
| [docs/api.md](docs/api.md)                   | Personal access tokens, which routes take one, and the session-only exceptions; the endpoint reference itself is `/api`                |
