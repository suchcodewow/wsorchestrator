# Operations

The deployed environment, the parts of it that are not guessable from the code,
and the outages currently in force.

[DEPLOY.md](../DEPLOY.md) covers *how* to deploy. This covers what you are
deploying into, and the things that have each cost a debugging round.

---

## The environment

| | |
| --- | --- |
| **GCP admin project** | `administration-459416` |
| **GCP org** | `harnessevents.io` (`805624170808`) |
| **Billing account** | `0175E2-FBAB8D-653C7C` |
| **Region** | `us-central1` (workshops build in `workshop_region`, default `us-west1`) |
| **App** | https://workshop-orchestrator-huwxhhkega-uc.a.run.app |
| **Harness account** | `8mh-FIIHQUapLuB6K0Cd-w`, org `operations`, project `orchestrator` |
| **AWS org** | `o-dkapjlbqe5`, management account `654129064688` (admin@harnessevents.io) |
| **AWS member accounts** | under OU `ou-soom-m1awl627` ("Workshops") |

Two state buckets, and they must stay distinct:

- **`events-tfstate`** — the admin config's own backend, prefix `admin/`.
- **`events-ws-tfstate`** — per-run workshop state.

Reusing one name for both breaks the bootstrap: `tfstate_bucket` has to differ
from the bucket `make bootstrap` creates.

---

## Non-obvious environment facts

Each of these cost a debugging round the first time.

**The org enforces `iam.automaticIamGrantsForDefaultServiceAccounts`.** Cloud
Build's default service account therefore has no permissions. Use the dedicated
**`build-sa`** (in [infra/admin/build.tf](../infra/admin/build.tf)) via
`gcloud builds submit --service-account`.

**A TLS-inspecting VPN breaks the Cloud SQL Auth Proxy.** On a laptop behind
Zscaler-style inspection (`utun0`–`utun6`), the proxy's mTLS on `:3307` fails —
bare TCP connects, then the TLS handshake resets. Run `make db-push` / `make
seed` / anything through `with-db.sh` with the **VPN off**, or from Cloud Shell.
The symptom is `ECONNRESET` against `:3307`.

**Zscaler re-signs `api.hibob.com`, and Node rejects the certificate.** So an
eVals HiBob sync run locally fails with `unable to get local issuer
certificate`, while GitHub and Harness calls are unaffected.
`NODE_USE_SYSTEM_CA=1` makes Node trust the macOS keychain, which holds the
Zscaler root. `npm run dev` sets it. A `tsx` script that calls HiBob needs it
set by hand. Cloud Run is not behind Zscaler and does not need it.

**`AUTH_URL` must be pinned** via the `app_url` variable. Left to guess its own
host, Cloud Run produces a `0.0.0.0:8080` `redirect_uri` that Google rejects.

**Cloud SQL Postgres needs `edition=ENTERPRISE` + `db-custom-1-3840`.** The
shared-core `db-f1-micro` is MySQL-only, and `ENTERPRISE_PLUS` rejects custom
tiers.

**Environment variables reach Cloud Run only through the infrastructure apply.**
`make ship` and the deploy pipeline's build stage run `gcloud run services
update --image`, which swaps the image and leaves the environment untouched. So
a new or changed `SITE_ADMIN_EMAILS` — or any env var — needs the OpenTofu
apply, not a rebuild. The value lives on the environment's IaCM workspace in
Harness, a secret as a `tf_*` Harness secret; change it there, then run
`deploy_qa` for QA or `deploy_production` with `run_infra=true` for production.
See [Where secrets and settings live](environments.md#where-secrets-and-settings-live).

Terraform declares `ignore_changes` on the app image, so an apply does **not**
revert a pipeline-deployed image. Verified: revisions share the same digest.

**The cohort Slack channel sync starts in dry run, and its bot needs more
scopes than the Sheet's had.** After each scheduled HiBob sync, and only while
a bootcamp is active, `lib/cohorts/slack-sync.ts` keeps
`sales-bootcamp-{mon}-{yyyy}`, `se-bootcamp-…` and the `-intermediate-` pair
in step with Cohorts → Current and Cohort Settings → Additional Channel
Contacts. It removes only people it invited itself (`slack_channel_members`),
never anyone added by hand. Every run is a dry run until someone presses
*Go live* on Cohort Settings → Slack. The bot is the Slack app's: *Add to
Slack* on that tab runs Slack's OAuth install with `SLACK_APP_CLIENT_ID` and
`SLACK_APP_CLIENT_SECRET` (from `slack_app_client_id` /
`tf_slack_app_client_secret`, set on production's workspace only; see
[What the two share](environments.md#what-the-two-share-and-why-that-matters))
and seals the bot token into `slack_installation`. The app's Redirect URLs on
api.slack.com must include `{app_url}/api/cohorts/slack/oauth/callback`, or
Slack refuses the install with `bad_redirect_uri`. Until the app is added, a
`SLACK_BOT_TOKEN` (`slack_bot_token` / `tf_slack_bot_token`) is used instead.
The install asks for `users:read`, `users:read.email`, `channels:read`,
`channels:manage` and `channels:join`, and the tab lists any Slack did not
grant. The Sheet's old bot
(`sheets_to_slack_conne`) has only the first two and `channels:manage`, so on
that token a run fails with `conversations.list answered missing_scope (needs
channels:read)`. A Slack admin must grant the rest and reinstall. Sending a DM
would also need `chat:write` and `im:write`. Slack keeps an archived channel's
name taken. A run that meets one logs a failure for that channel and leaves
it alone; unarchive it or rename it.

**This machine class has `tofu`, not `terraform`.** The Makefile and bootstrap
script auto-detect which is present.

---

## Reaching the production database

The published workshops and lab guides live in the **Cloud SQL** `workshops`
database. Your local `workshops` is a different database with different rows —
see [the two local databases](../CONTRIBUTING.md#the-two-local-databases).

Run from the repo root, and **pass `PROJECT`**. `gcloud config`'s default
project on a Harness laptop is typically `sales-209522`, so without it
`with-db.sh` fails with "No DB_CONN … and none found":

```bash
PROJECT=administration-459416 ./scripts/with-db.sh "node frontend/scripts/whatever.mjs"
```

[`with-db.sh`](../scripts/with-db.sh) opens its own `cloud-sql-proxy` on a port
it scans for in `6543`–`6563`, pulls credentials from the `database-url` secret,
and exports `DATABASE_URL`. It deliberately **refuses to share a port it did not
open** — an earlier version defaulted to `:5432`, failed to bind because
something else was there, saw the other listener pass its readiness check, and
ran a migration against a surprise database with Cloud SQL credentials in hand.

Which means, on a dev laptop:

| Listener | What it is |
| --- | --- |
| `:5432` | Your local Docker Postgres. Under Colima, `lsof` reports this as an `ssh` process — that is the VM's port-forward mux, not a foreign tunnel. |
| `:5433`, or `6543`+ from someone else's run | A `cloud-sql-proxy`. **That one is production.** |

Confirm which database you are actually on with a query rather than by reading
`lsof`:

```bash
set -a && . frontend/.env && set +a
node -e "const pg=require('pg');(async()=>{const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();console.log((await c.query('select current_database(), inet_server_port()')).rows);await c.end();})()"
```

Scripts run through `with-db.sh` must live **inside `frontend/`** so `pg`
resolves from its `node_modules`. A script in `/tmp` dies with
`ERR_MODULE_NOT_FOUND: pg`.

`gcloud` credentials expire, and reauth needs an interactive browser login. When
`gcloud sql instances list` reports "Reauthentication failed", that is what has
happened. `make tf-admin-sa` moves deploys onto a service account key, which no
session policy expires — see
[infra/admin/README.md](../infra/admin/README.md#operator-credentials).

### Inspecting an AWS member account

The laptop's `aws` CLI is normally logged in as the management account **root**,
which can read IAM and Organizations but **cannot assume roles** ("Roles may not
be assumed by root accounts"). Inspecting a workshop's member account needs the
`workshop-orchestrator` user's static keys. Deploys read them from the Harness
secrets `tf_aws_access_key_id` and `tf_aws_secret_access_key`, but Harness never
shows a secret's value again, so the only readable copy is the owner's
git-ignored `infra/admin/terraform.tfvars`.

That login is the CLI-v2 root-session flow (`login_session = arn:...:root` in
`~/.aws/config`, cache under `~/.aws/login`), and **the OpenTofu AWS provider
cannot read it**. A local `tofu plan/apply/destroy` against AWS dies with "No
valid credential sources found" until static `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` are exported. State-only commands (`tofu state list`,
`tofu state rm`) work without them.

---

## Known issues

### A red `OptInRequired` in an AWS run log is normally a warm-up, not a fault

Organizations reports a new member account `ACTIVE` the moment `CreateAccount`
returns, but EC2 takes another 60–120 seconds, and the apply first calls EC2
about 8 seconds in. So almost every AWS run logs a red
`Error: … OptInRequired` block, waits (`retrying in 60s`), and then builds
normally. `AWS_ACCOUNT_WARMUP_SIGNATURES` in
[runner/src/classify.ts](../runner/src/classify.ts) is what retries it.
Verified on 2026-09-12, run `fe1c540a` / account `357647916927`: EC2 refused
8 seconds after creation, the retry 60 seconds later succeeded, and the VPC,
subnets and EKS cluster built.

**Before treating it as an outage, check whether the run recovered.** Look in
`run_logs` for the retry line followed by `Creation complete`, rather than
reading the first red block as the outcome. Only conclude the account was never
activated if it still refuses EC2 *minutes* later when probed directly with the
orchestrator's keys.

That did happen once. Between about 2026-09-02 and 2026-09-08 new accounts were
created `ACTIVE` but never had services switched on: EC2 `OptInRequired`, S3
`NotSignedUp`, EKS `SubscriptionRequiredException`, still true hours later. Every
AWS run failed. It cleared on its own, with no code change and no AWS Support
case.

**Still open, and separate:** `sts:AssumeRole` into a `SUSPENDED` account fails
and the AWS provider silently falls back to management credentials. That is the
source of `role_arn is required, but no definition was found` and
`AccessDenied … user/workshop-orchestrator` in reaper teardowns; runs
`1dc3ab1d` and `8cfff126` sat in `destroy_failed` on it.

### Challenge mode has never run for real

As of 2026-09-13 production had 27 runs, all `mode = 'workshop'`: zero
challenges, ever. The code, the three roots under
`runner/terraform/challenges/` and the teardown path are complete and
internally consistent. They validate, and the tfvars the runner writes match
every variable each root declares. *Scenarios*
([runner/terraform/scenarios](../runner/terraform/scenarios)) pass the same
static checks. None of it has met a live cloud, so treat "challenge mode works"
as static-analysis confidence only.

Where the first real run is likely to find problems:

- AWS creates one account per competitor, **sequentially**. Account creation is
  slow and rate-limited, and each one has the warm-up above.
- Azure needs a Temporary Access Pass per competitor, or mandatory MFA locks them
  out of the portal (see [runner/README.md](../runner/README.md)).
- A GCP competitor's project has only `compute.googleapis.com` enabled. Enabling
  `container.googleapis.com` is the competitor's job, deliberately: building the
  cluster is the challenge.

A challenge also gets **no Harness cloud connector and no delegate**, on
purpose: one org-scoped connector cannot stand for per-competitor environments,
and installing a delegate is the win condition for the connectivity scenarios.
Do not "fix" it by installing one automatically.

### QA's reaper or scheduler stopped after a production import

A production import on QA pauses `tf-reaper-trigger` and
`tf-scheduler-trigger` while it runs. It leaves them paused on purpose if it
failed between the restore and the quarantine, or if the execution hit the
job's 3600s timeout. Either way the database may list production's workshops
without marking them as production's, and resuming would let QA's reaper tear
them down. Check the `tf-runner` execution's `component: "production-import"`
logs before resuming anything, then follow
[When it goes wrong](environments.md#when-it-goes-wrong).

Imported events on QA show "Imported from production" and refuse every
change. That is the quarantine working, not a bug.

### About 64 template failures on every content deploy (left alone)

"Deploy content", and workshop provisioning, report a large batch of template
failures (64 as of 2026-09-13). They come from the site's template source, the
**sandbox / Demo_Committee** project of the *HarnessEvents* source account, and
they are all v1/Agent templates. This is known, and Shawn decided on 2026-09-13
to leave it alone. Do not re-investigate it from scratch, and do not "fix" it
without asking.

### Harness has no admin set-password API

Harness NG exposes no API for an administrator to set another user's password to
a chosen value, so attendee Harness access stays **Google SSO** rather than the
one-username-and-password-everywhere shape the other clouds get. Since SSO rides
the same Google password the runner controls, it is effectively the same
credential — just not a native password box.

The only password-write endpoint on NG is `PUT /ng/api/user/password`
(operationId `changeuserpassword`), which is self-service: it takes no user id
and acts on whoever the API key belongs to, so with the runner's admin PAT it
would change the *admin's* password. Admin "reset password" only generates a
random one.

Three dead ends, each checked against harness-core source so nobody re-derives
them:

- **`POST /ng/api/user/impersonate/{userId}`** mints no JWT, no cookie, no
  session. `NgUserServiceImpl.startImpersonation` saves an audit event, emails
  both users, and returns `true`. The token-issuing "impersonation" is the
  FirstGen browser login flow, not this REST call.
- **`changePassword` fails closed against an absent hash.** It bcrypt-compares
  `currentPassword` to the stored hash, so an SSO-only user with no hash is
  rejected — "no password set" does not mean "any password accepted".
- **`InviteDTO` carries no token field**, so the invite APIs cannot hand you an
  invite link either.

The one route that *would* work, if a native password is ever genuinely
required, is the public reset flow: `POST /api/users/reset-password` (no auth,
body `{email}`) emails a signed token, and `POST
/api/users/reset-password/{token}` (body `{password}`) sets the password with no
`currentPassword`. Combined with reading the attendee's mailbox — the runner
owns the Workspace domain, so adding `gmail.readonly` to the DWD scopes in
[runner/src/directory.ts](../runner/src/directory.ts) would do it — that is two
API calls and one Gmail read, no browser automation. Caveats: those are FirstGen
`/api/users/*` paths from a public source snapshot, so confirm they are still
live before building on them; the password must satisfy the account strength
policy; and a native password is only usable if the account's auth mechanism
allows native login alongside Google OAuth.
