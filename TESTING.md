# Testing the orchestrator

Written after `aws-cardinal` (2026-09-07) failed halfway through its roster on a
Harness reply that meant "already done". The same reply had failed
`aws-platform-team` on 2026-08-21. Nothing in between changed, because nothing
in this repository could notice.

That is the actual reliability problem. Not that the clouds are flaky — they are,
and always will be — but that **every lesson learned from a failed run has been
stored in a comment**. Comments do not fail a build. So each fix held only for as
long as someone remembered it, and the same string came back seventeen days
later and cost another workshop.

## What the failures actually are

Every provisioning failure in `workshop_runs` to date, by cause:

| Cause | Runs hit | Where it is decided | Testable without a cloud? |
| --- | --- | --- | --- |
| A partner API refuses something it already did | 3 | `isDuplicate` | **Yes** |
| A new cloud identity is not usable yet | 4 | `awsRetryKind` | **Yes** |
| A zone has no capacity | — | `isGkeCapacityError` | **Yes** |
| Static Terraform error | 1 | `tofu validate` / `plan` | **Yes** |
| Stale state lock from a killed run | 2 | nothing yet | Partly |
| Teardown retried forever on an impossible destroy | 2 | `destroy-policy.ts` | **Yes** |
| An API not yet enabled in a fresh project | 1 | Terraform | No |

The shape of that table is the finding. Nearly every failure is **a pure function
reading a string and reaching the wrong conclusion** — and until now not one of
those functions had a single test. Not one. `npm run typecheck` existed in
`runner/package.json` and nothing ever ran it; the runner ships raw TypeScript
executed by `tsx`, so there was no compile step of any kind between a commit and
a live workshop.

## Layer 1 — the classifiers (in place)

`runner/test/` runs on every build. 82 tests, ~90ms, no cloud, no database, no
credentials.

The centre of it is `test/fixtures/production-failures.ts`: **the verbatim text of
every message a real run has died on**, each tagged with the run and date it came
from and the verdict the runner should reach. The tests are a loop over that
corpus. Its value is not cleverness, it is that an August failure cannot recur in
October without going red first.

Also covered, because they are equally pure and equally consequential:

- `harnessIdentifier` / `orgIdentifier` / `projectIdentifier` — asserted against
  Harness's own identifier regex over real workshop names and adversarial ones
  (reserved words, leading digits, combining marks, 200 characters, emoji).
  Teardown recomputes these from the name, so instability here orphans an org.
- `retry.ts` — that a refusal comes back **unchanged and immediately** (the
  409-means-already-exists path in `directory.ts` depends on it), and that
  Google's HTML error page is recognised as the 5xx it is.

Two rules are deliberately duplicated between the runner and the frontend, and
both files say they are meant to agree. `harness-errors.test.ts` and
`identifier.test.ts` now run one corpus through **both copies** and fail if they
drift. That is what makes the duplication safe rather than a slow leak.

### The workflow this is for

When a run fails on a provider message, **add the fixture before the fix**:

1. Paste the verbatim message into `production-failures.ts` with its run, date,
   expected verdict, and why.
2. Run `npm test` in `runner/`. It must fail, and for the right reason.
3. Fix the classifier. It must pass.

The order matters. It proves the test exercises the real defect, and it puts the
knowledge somewhere executable instead of in a commit message nobody re-reads. A
fixture dated *after* a fix that was meant to handle it is a regression; one that
appears twice means the fix never landed. Both of those are visible now.

## Layer 2 — static checks (in place)

- The Harness pipeline `deploy_workshop_orchestrator` gains a **Verify stage**,
  first, ahead of the infrastructure apply and both image builds: `npm ci &&
  npm run verify` in `runner/`. This is the gate that was missing entirely, and
  it is on the path a push to main actually takes.

  Worth being explicit about why it took two tries to put it in the right place:
  a `verify` step was first added to `cloudbuild.yaml`, which reads like the
  deploy path and no longer is. The Cloud Build trigger was removed when CD moved
  to Harness, so that step gates only `make images`. **A test that cannot fail a
  deploy is a comment.** That is the same failure mode this whole document is
  about, one level up. The step is kept there anyway — `make images` is the
  break-glass route for when Harness is down — but the pipeline is the gate.

  The pipeline is stored INLINE in Harness and so was not in the repository at
  all: unreviewable, undiffable, and no record of who changed the deploy path or
  when. It is now mirrored at `infra/admin/deploy-pipeline.yml`. That is a mirror
  and not the source, which is a weakness; converting the pipeline to a
  git-backed (REMOTE) definition would remove the class of drift entirely and is
  the right next move on this file.

  **The gate was checked against a failing commit, not just a passing one.** A
  green stage that cannot go red is worth nothing, so a throwaway branch with one
  deliberately false assertion was run through the pipeline (run 14,
  2026-09-07): Verify failed, and `infra` and `build_migrate_deploy` both
  reported `Skipped`. Nothing was applied, built, pushed, or deployed. Worth
  repeating that check if the pipeline's stage conditions are ever edited — it is
  a minute of work and it is the only thing that distinguishes a gate from a
  decoration.
- `runner/Dockerfile` now runs `tofu validate` on all ten Terraform roots
  alongside the `tofu init` it already did. Free, and fails the image instead of
  a workshop. This one runs inside the image build, so it gates both paths
  already.

`tofu validate` does not catch everything. The `Invalid for_each argument` that
killed `aws-platform-team` on 2026-08-20 is a *plan*-time error over apply-time
values, and needs a real plan against real credentials — see layer 3.

## Layer 3 — a nightly run against the real APIs (recommended next)

Layers 1 and 2 cannot catch a partner API changing its behaviour, which is what
both Harness failures were. Only talking to it can.

The mechanism already exists: **`harness_only` sandbox mode**. It creates an org,
the attendee role, one project, and the role bindings — the exact sequence that
failed on 2026-09-07 — and touches no cloud account, so it costs a few seconds
and nothing per night.

Recommended: a Cloud Scheduler job that starts a `harness_only` run against a
throwaway workshop name, asserts it reaches `ready`, and tears it down. Today's
bug would have surfaced within 24 hours, on a name nobody was presenting to.

Worth adding beside it, in rough order of value per unit of effort:

1. **A `tofu plan` of each root against real credentials**, nightly. Catches the
   `for_each` class and any provider-version drift, without creating anything.
2. **A full one-attendee workshop per cloud**, weekly. The only thing that
   exercises account creation, the warm-up windows, and teardown end to end.
   Time-box it and alert on the failure, not the duration.
3. **Assert on the run's outputs, not just its status.** `ready` currently means
   "no step threw". It should mean the attendee has a project, a role binding,
   and a working credential — which is what an attendee will find out for us
   otherwise. The check against the Harness account that confirmed today's
   diagnosis (`_project_admin` on `_all_project_level_resources`) is exactly the
   assertion worth automating.

## Two defects this investigation surfaced

**Teardown retried forever — fixed, twice.** `reap.ts` caught any destroy failure
and left the run for the next tick, with no attempt cap and no backoff. A closed AWS
account leaves its organization on AWS's schedule, not within the provider's
10-minute wait, so `aws_organizations_account` destroy can never succeed — and the
reaper kept trying. Every five minutes, for as long as the run existed:
`zone-b-dfae0a` logged **9,482 failed attempts over 33 days**, `aws-platform` **640
over three**.

The first fix bounded the loop — permanent failures stopped on attempt 1, everything
else backed off through a budget of eight attempts — and it worked, in that both
runs stopped. But it kept the premise that a failed teardown is probably worth
repeating, and the production evidence says otherwise: in both cases every single
attempt was doomed for the same reason as the first, and each one is a Cloud Run
execution plus a full `tofu init`/`destroy` against live cloud APIs. Cost control is
the whole point of the reaper.

So the budget is gone too. **One attempt, then a person.** A teardown that does not
finish lands in a terminal `destroy_failed` with the reason on the row and a **Retry
teardown** button on its page. Four details carry the weight:

- `reapableRuns` had to exclude `destroy_failed` **explicitly**. Its first clause is
  `delete_requested`, which is what started the teardown, so a terminal status alone
  would not have stopped the loop — the run would still have been handed back every
  tick. A terminal state you can still be selected out of is not terminal.
- **A teardown that never returns is flagged too**, and this is the shape the budget
  could not see: the counter only advanced from the reaper's catch block, so a
  `tofu destroy` killed by the job's `timeout = "1800s"` — or an OOM, or a rolled
  deploy — left the counter untouched and got a full budget again next tick. Same
  infinite loop, invisible to the thing built to stop it. `claimDestroy` closes it:
  the claim is written before any work and cleared on every way out, and because the
  caller holds the run's session-scoped advisory lock, *seeing a claim while holding
  the lock proves the claimant is gone.*
- `tofu destroy exited with code 1` used to be the **entire** stored error — the
  provider's diagnostics went only to `run_logs` — so `isPermanentDestroyFailure`
  could never match, and `aws-platform` was reported as "failed 8 times" instead of
  "cannot succeed". `terraform.ts` now attaches the last 12 stderr lines to the
  thrown error. With no retry left, that text *is* the handover.
- `"timeout while waiting for resource to be gone"` (terminal) and
  `"timeout while waiting for state to become"` (a starved GKE zone — move and
  retry) share five words and have opposite verdicts. `classify.test.ts` asserts
  each against the other's classifier so neither can be widened into the other, and
  every fixture *not* marked `permanentDestroy` is asserted to stay retryable. The
  asymmetry is the point: a false negative costs a person a click, a false positive
  walks away from a cloud account that is still billing.

The trade is deliberate: a genuinely transient failure — a state lock from a killed
container, AWS eventual consistency, Workspace lagging an account delete — no longer
heals itself in five minutes. It waits for a human, and what it holds keeps billing
until then. That is acceptable only because the flag is loud, and because a silent
loop was the more expensive failure by 9,482 attempts to one.

`make stuck-teardowns` is how you find out without waiting to be told — read-only,
and it exits non-zero when something needs a person:

```sh
make stuck-teardowns
```

It sorts every run in `destroying` or `destroy_failed` into four shapes. Two are
transient and healthy; the interesting ones are the two that look identical in the
database to a run making progress:

| shape | means |
| --- | --- |
| `queued` / `in progress` | healthy. Waiting for a tick, or inside its one attempt. |
| `flagged` | terminal `destroy_failed`. The policy working — deal with the cause and press **Retry teardown**. Still billing until you do. |
| `claim never cleared` | claimed 40m+ ago and neither finished nor flagged. It cannot still be running (1800s cap), so no tick has reached the run since. Check the reaper job's executions and for a held advisory lock. |
| `never picked up` | in `destroying`, unclaimed, an hour+ after becoming eligible. The reaper is not running, is failing before it reaches this run, or a dead session's lock is still held. **Nothing will flag this on its own.** |

It also prints the count of teardown-failure lines in `run_logs` beside the stored
counter, matching all three generations of log line. When the log outruns the
counter, that history predates the one-attempt policy — which is how the 9,482
attempts would have shown up on day one.

**Teardown reads IAM with the wrong credentials — still open.** During `aws-platform`'s
destroy, `iam:GetUser` on the attendee users was refused as
`arn:aws:iam::654129064688:user/workshop-orchestrator is not authorized` — that
is the *management* account's user reaching for resources that live in the member
account, rather than assuming a role into it. Pinned as a fixture
(`aws-iam-access-denied-orchestrator`) with `expect: "fail"`, because the
tempting fix — adding `accessdenied` to the warm-up signatures — would convert a
missing IAM policy into an eleven-minute wait that then reports the wrong cause.

## Running it

```sh
cd runner
npm test          # the suite, ~90ms
npm run test:watch
npm run verify    # typecheck + tests, what CI runs
```

---

# Exercising code without deploying

The unit suite covers the pure functions. Everything else in this repo talks to
a cloud, a database, or a browser, and the obvious way to check it — push and
watch the deploy — is slow and happens in production. Three techniques cover
almost every case.

All three run against **`workshops_agent`**, never `workshops`. See
[the two local databases](CONTRIBUTING.md#the-two-local-databases).

## A runner module, end to end

A module in `runner/src/` can be driven in seconds without deploying the Cloud
Run job. Write a small entry script **inside `runner/`** — so `pg` and `tsx`
resolve — run it, and delete it afterwards.

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/workshops_agent
export HARNESS_TOKEN_ENC_KEY=anything    # seal/open only has to agree with itself
export HARNESS_ACCOUNT_ID=8mh-FIIHQUapLuB6K0Cd-w
export HARNESS_API_KEY=$(grep infra/admin/terraform.tfvars -e harness_api_key | sed 's/.*= *"//; s/"//')
npx tsx probe-thing.ts
```

`workshops_agent` already carries the full schema and the six baseline
`harness_components` rows, so it is the database to seed against.

**For anything that talks to Harness, build throwaway orgs.** Create
`wo_probe_src` / `wo_probe_dst` over REST, run the module against them, read the
result back out of both the API *and* `run_logs` / `run_resources`, then
`DELETE /ng/api/organizations/<id>` — which removes the org with everything in
it. See [docs/harness.md](docs/harness.md) for the API paths.

A sealed secret column (`harness_template_sources.secret`,
`harness_org_secrets.secret`) can be written from a seed script by copying the
20 lines of AES-GCM out of
[frontend/src/lib/secret-box.ts](frontend/src/lib/secret-box.ts). The runner's
copy only decrypts, on purpose.

`psql` is not on the host PATH:

```bash
docker exec workshoporchestrator-postgres-1 psql -U postgres -d workshops_agent
```

## A frontend `server-only` library

To exercise a lib that starts with `import "server-only"`, put a scratch `.mts`
file in `frontend/`, import through the `@/` alias, and run:

```bash
npx tsx --conditions=react-server scratch.mts
```

with `DATABASE_URL` pointed at `workshops_agent` and `AUTH_SECRET` taken from
`frontend/.env`.

**`--conditions=react-server` is the whole trick.** Without it Node resolves the
`server-only` package to its client entry and throws "This module cannot be
imported from a Client Component module" before your code runs. The alternative
— a second dev server with a seeded session row and a cookie — is far more setup
for the same answer.

Keep the scratch file inside the package so tsconfig paths apply, and delete it
when you are done.

## A screenshot of a signed-in page

Verifying a UI change visually takes three tricks, none of them obvious.

1. **Auth.** Sessions are database-strategy NextAuth, so a signed-in view needs
   only a `users` row plus a `sessions` row whose `sessionToken` you then send
   as the `authjs.session-token` cookie. No Google round-trip.
2. **Cookies in headless Chrome.** `--headless=new --screenshot` cannot set one.
   Run a ~20-line Node proxy that forwards to the dev server and adds the
   `Cookie` header, and point Chrome at the proxy.
3. **The page renders blank without a CSS override.** Every card is wrapped in
   framer-motion variants that SSR as `style="opacity:0"` and only clear on
   hydration, which headless dev-mode never reaches inside its virtual time
   budget. Have the proxy inject, before `</head>`:
   ```html
   <style>[style*="opacity:0"]{opacity:1!important;transform:none!important}</style>
   ```

Then the things that will bite:

- **Next 16 refuses a second dev server for the same directory.** It prints
  "Another next dev server is already running" and names the PID of whoever is
  on 3000 — which may be a colleague's. Do not kill it. `rsync` the tree to a
  scratch copy, `cp -al` node_modules in (a symlink fails: Turbopack rejects one
  pointing outside the project root), and run there. Re-`rsync`ing resets that
  copy's `.env` back to the real `workshops` database and port 3000, so
  re-point `DATABASE_URL` after every sync, before anything runs.
- **To capture an expanded or toggled state, edit the copy** to default the
  state open. Injecting CSS to un-hide `[hidden]` does not take. When the state
  comes from a cookie the server reads (theme, sidebar), have the proxy send
  that cookie instead.
- **A stored user preference beats a cookie.** Setting `theme=dark` on the proxy
  paints dark and then flips back, because the client re-applies the
  `users.theme_preference` row after hydration. Update the row.
- **`--window-size` has a ~500px floor on macOS**, so a 390px phone is silently
  photographed at 500 and the one width that overflows goes untested. Drive
  Chrome over CDP instead — `--remote-debugging-port`, then
  `Emulation.setDeviceMetricsOverride`, which has no floor. Node's global
  `WebSocket` is enough; no puppeteer needed. While there, read
  `documentElement.scrollWidth` against `clientWidth` so horizontal overflow is
  a number rather than a judgement about a picture.

**When the screenshot is illegible, stop and read the HTML instead.** On
2026-09-06 headless Chrome rendered every glyph on the page as mojibake, in both
`--headless=new` and `--headless=old`, so the picture said nothing about the
change. `curl` through the same proxy and grep the markup: asserting on
`aria-label="…"`, row identifiers, and rendered copy verified structure, data,
and per-row status marks faster than any screenshot would have. RSC boundary
errors surface there as a 500 too — which is how the "Functions cannot be passed
directly to Client Components" bug in the tab row was found, having passed both
`tsc --noEmit` and `eslint`.
