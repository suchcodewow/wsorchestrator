# Working in this repo

Guidance for AI coding agents. Humans: [CONTRIBUTING.md](CONTRIBUTING.md) is the
one to read.

## Guardrails

These are the mistakes that have actually been made here, each of which
destroyed work or broke something live.

**The local `workshops` database is not scratch space.** It holds real authored
workshops and lab guides. Use **`workshops_agent`** for anything you seed,
mutate, or clean up. Never run an unqualified `DELETE` or `TRUNCATE` against
`workshops`; if a test must touch it, delete only rows by the ids that test
created.

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

**A push to `main` deploys to production.** It applies infrastructure, migrates
Cloud SQL, and rolls Cloud Run. There is no staging. Do not push to test
something — run the pipeline by hand with `deploy=false` and `apply_infra=false`
instead. Two deploys running at once will fight over the same OpenTofu workspace
and database.

## Conventions

**A `schema.ts` change must be applied to the local database in the same
turn.** Code reading a column the local database lacks fails at *runtime*;
`npm run typecheck` passes and the developer finds out by hitting a broken page.
Run the new `frontend/drizzle/NNNN_*.sql` (they are written to be re-runnable)
rather than `drizzle-kit push --force`, which drops things.

**A `schema.ts` change must also be paired with a migration in
`frontend/drizzle/`**, or it never reaches production — the pipeline runs the
`.sql` files and never `db:push`.

**The Harness pipeline is stored inline and mirrored at
`infra/admin/deploy-pipeline.yml`.** Update both in the same commit, or the
change either does not run or is invisible to review.

## Before saying you are done

```bash
cd runner    && npm run verify              # typecheck + unit tests, the CI gate
cd frontend  && npm run typecheck && npm run lint
```

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

| Document | Covers |
| --- | --- |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Clone to running locally; schema changes; how a change ships |
| [README.md](README.md) | What the product does, architecture, standing up a new deployment |
| [DEPLOY.md](DEPLOY.md) | Makefile targets, the deploy pipeline, rollback |
| [TESTING.md](TESTING.md) | Why the runner's tests exist; exercising code without deploying |
| [docs/operations.md](docs/operations.md) | The deployed environment, its quirks, production data, known outages |
| [docs/harness.md](docs/harness.md) | Harness API access and the pipeline/trigger traps |
