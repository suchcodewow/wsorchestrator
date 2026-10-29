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
api.slack.com must include `{app_url}/api/auth/callback/google`, the
[one OAuth callback](#one-oauth-callback) every connection shares, or Slack
refuses the install with `bad_redirect_uri`. Until the app is added, a
`SLACK_BOT_TOKEN` (`slack_bot_token` / `tf_slack_bot_token`) is used instead.
The install asks for `users:read`, `users:read.email`, `channels:read`,
`channels:manage` and `channels:join`, and for the intake reminders' direct
messages `chat:write` and `im:write`; the tab lists any Slack did not grant.
An app installed before the last two were asked for keeps syncing channels,
but cannot send the reminders until a platform administrator presses *Add to Slack* again on Admin Settings → External Connectors.
The Sheet's old bot
(`sheets_to_slack_conne`) has only the first two and `channels:manage`, so on
that token a run fails with `conversations.list answered missing_scope (needs
channels:read)`. A Slack admin must grant the rest and reinstall. Slack keeps an archived channel's
name taken. A run that meets one logs a failure for that channel and leaves
it alone; unarchive it or rename it.

**The intake form's daily Slack reminder is off until someone turns it on,
and is sent by the cohort Slack sync.** One run of the sync does everything
the bot does: the channels above, and a direct message to everyone in the
current cohort (Cohorts → Current, Sales and Engineer tracks) who has not
saved answers to their stage's form at /intake. The run that follows the
3 AM HiBob sync does both, the channels and then the reminders, and so does
*Sync Now* on Cohort Settings → Slack. A run whose channels use up its time
stops there, and that day's reminders wait for the next run. Reminders go out only once a
Training Administrator turns the *Daily reminder* on, under *Mode* on
Cohort Settings → Slack, which also shows how many have answered each form,
at most once per Eastern day however many runs there are, and never for a
form with no questions. In dry run they are logged, each with its text and
recipient, not sent; *Preview* on the Slack tab makes any run a dry run, and
every run's page lists what it did and sent, channel by channel and person
by person. A dry run works even with Slack not connected, as on QA or a
developer's machine: it cannot see who is already in a channel or has an
account, so it lists every channel not yet created, everyone each should
hold, and every reminder due, and says so at the top of the run. Every run is also in the audit trail.

**This machine class has `tofu`, not `terraform`.** The Makefile and bootstrap
script auto-detect which is present.

### One OAuth callback

Every account the app connects returns to one redirect URI,
`{app_url}/api/auth/callback/google`, which is also Google sign-in's. Register
it once with each provider and no new connection needs another:

| Provider | Where | Status |
| --- | --- | --- |
| Google (sign-in, Google Meetings) | OAuth client in `AUTH_GOOGLE_ID` → Authorized redirect URIs | Already there for every environment |
| Slack (Add to Slack) | api.slack.com → the app → OAuth & Permissions → Redirect URLs | Add it, replacing the old `/api/cohorts/slack/oauth/callback` |

Auth.js owns that path and cannot be moved off it, so the other flows come to
it. Their state starts `wo.<purpose>.`; the Auth.js route hands those to
`lib/oauth-purposes.ts` and every other state to Auth.js. A new connection is
an entry there and a start route that calls `startOAuth`
(`lib/oauth-callback.ts`). The "google" in the path is Auth.js's provider id;
Slack does not mind it.

### Which sites may frame the app

Every page goes out with `Content-Security-Policy: frame-ancestors 'self' …`,
built by the proxy from **Admin Settings → Allowed Domains → Allowed iFrame
Domains** (`src/lib/frame-domains.ts`). Each listed domain also allows its
subdomains. With no rows, only the app's own pages may frame it, so a new
deployment refuses Mindtickle until someone adds its domain. Each instance
reads the list at most every 30 seconds, so a change can take that long to
reach every instance. When a site is refused, the browser's console names the
ancestor that was refused, and that is the domain to add. A frame nested inside
another frame needs every site in the chain listed.

### Timed jobs

Admin Settings → Timed Jobs lists every job that runs on a timer. The
reaper and the workshop scheduler are Cloud Run jobs with a Cloud Scheduler
job each (`tf-reaper-trigger`, `tf-scheduler-trigger`), and their schedule is
set in Terraform. The app's own jobs (the HiBob sync, with the cohort Slack
sync and intake reminders after it; the Google Meetings sync; the Canary
Wire's pull) have one Cloud Scheduler job between them, `timed-jobs-tick`,
which calls `/api/settings/timed-jobs/tick` every five minutes with an OIDC
token for the scheduler service account. The app starts whichever has fallen
due on the schedule kept in `timed_jobs` (set on the tab; the registry's
default until then), claiming each time first so a retried tick starts
nothing twice. A time missed by more than 30 minutes, say while a deploy
rolled, is skipped rather than run late. Each job runs the same code as its
Sync Now button, so it is a dry run while its sync is not live and follows
the test group while it is on.

### Inside a Mindtickle frame

Mindtickle shows the app by framing any of its URLs in an ordinary
`<iframe>`; there is no package or LTI registration. A framed page shows
only its content, with no header or sidebar, and is always light: the inline
theme script marks `<html>` with `data-framed` before the first paint
(`lib/framed.ts`, the `framed:` variant in `globals.css`). The user's
light, dark or system preference is untouched, and so is the `theme` cookie
their own tabs paint from.

The session cookie is `SameSite=Lax`, so a framed page arrives signed out,
and Google will not be framed. Its sign-in button opens `/frame-signin` in a
popup instead, which hands the frame a one-minute ticket for a session of its
own in a `Partitioned` cookie. How that session is kept, and why the framing
site cannot make changes with it, is in `lib/frame-cookie.ts`. It works in
Chrome and Firefox. A browser that keeps no cookies for a frame on another
site gets a link to open the app in its own tab.

### Mimir Studio

Mimir Settings → Map takes a new slide deck and Mimir Settings → Mimir
Feedback has a Regenerate button for each concept. Both start the
`mimir-studio` Cloud Run job (`infra/admin/studio.tf`) with the job's row id.
The job spends the Claude and ElevenLabs keys, so it exists only where both
`anthropic_api_key` and `eleven_labs_token` are set. What it works from is in
the recordings bucket under `mimir/studio/`, its finished videos sit beside
the others, and none of it is in git. Setting a deployment up, the one-time
`seed-reference` upload and running it locally are in
[scripts/explainer-video/studio/README.md](../scripts/explainer-video/studio/README.md).

### Google Meetings

eVals Settings → Google Meetings invites the cohort to meetings that already
exist on the Revenue Enablement calendar
(`c_3pt3qoc60a1cn5lre92sc9r7s0@group.calendar.google.com`). The app makes no
meetings. An Assessments Administrator picks one of the names on the calendar
in the next 60 days and says whom it is for: Bootcamp, Intermediate or both,
and Sales, Engineers or both. A candidate counts as Intermediate once
their bootcamp history (`employees.btc_date`) gives them a BTC date.

The sync runs every day at 4:00 AM Eastern, started by the
[timed jobs](#timed-jobs) dispatcher, and whenever someone presses *Sync
Now*. Admin Settings → Timed Jobs can switch the daily run off or change when
it runs.
Each run does the following for each picked meeting
(`lib/evals/meeting-sync.ts`, with the rules in `lib/evals/meeting-plan.ts`):

- **Invites.** Each person on the Cohorts → Current tab whom the meeting is
  for is added to the next occurrence of it that falls before the active
  bootcamp's start date. So is every Assessments Administrator, on any
  occurrence that has a cohort member on it. Every change to the calendar is
  sent with `sendUpdates=none`, so Google emails no one: a new guest finds the
  invite on their calendar, and one taken off simply loses it. An invite whose
  guests are already right is left alone.
- **Who it takes off.** It takes off only the guests it added itself. Anyone
  added by hand, or by the meeting's owner, stays.
- **Replies.** It reads each guest's reply back from the event.
- **Attendance.** It reads attendance from Zoom once an occurrence has been
  over for 30 minutes.
  - A guest Zoom saw join, by email or by full name, is done.
  - A guest Zoom did not see is counted as missing. They are invited to the
    next occurrence, while one is left before the bootcamp.
  - An administrator's mark on the Current tab overrides Zoom either way.

The Current tab shows one icon per picked meeting beside each name:

| Icon                   | Meaning                                         |
| ---------------------- | ----------------------------------------------- |
| green check            | attended                                        |
| grey check             | accepted                                        |
| grey question mark     | not accepted yet                                |
| red exclamation mark   | no occurrence left before their bootcamp        |

**Dry run and the test group.** These work as they do on Cohort Settings →
Slack.

- A new environment starts in **dry run**. The sync logs everything it would
  do and changes nothing. *Preview* does the same whatever the setting.
- With the Cohorts test group on, the group is invited instead of the cohort,
  and no administrators are. Turning the group off takes it back off the
  invites it was given.

Every run is logged with each change it made: open a run from the tab's
*Sync log* view. Only one sync runs at a time.

Setting it up in an environment:

1. **The callback is already registered.** Google returns to
   `{AUTH_URL}/api/auth/callback/google`, the sign-in callback every
   environment has on the OAuth client in `AUTH_GOOGLE_ID` (see
   [One OAuth callback](#one-oauth-callback)). Nothing to add.
2. **Enable the Calendar API** (`calendar-json.googleapis.com`) on the project
   that owns that OAuth client. `infra/admin/apis.tf` does this on apply.
3. **Connect the account.**
   - A platform administrator presses *Connect Google account* on Admin
     Settings → External Connectors and signs in, allowing calendar access.
   - The account must have **Make changes to events** on the Revenue
     Enablement calendar. Without it the picker still lists the meetings, but
     every invite fails.
   - `google_meetings_account` (env `GOOGLE_USER`) only pre-fills the
     sign-in.
   - Do it once per environment. The token is sealed with that environment's
     key and kept in its database (`google_connections`).
   - It lasts until Google stops accepting it; *Reconnect* is the fix.
   - **Publish the OAuth consent screen** (APIs & Services → OAuth consent
     screen → *In production*). In *Testing* status Google expires a Calendar
     refresh token after 7 days.
4. **Zoom (optional; for attendance).**
   - Create a **General App** in the Zoom Marketplace, managed by *User*. Give
     it the user-level scopes `meeting:read:list_past_instances`,
     `meeting:read:list_past_participants`, `meeting:delete:meeting` and
     `user:read:user`, and nothing with `:admin`. `meeting:delete:meeting`
     only cancels the Zoom meetings the old create-a-meeting flow made.
   - Under OAuth, add `{AUTH_URL}/api/auth/callback/google` as the redirect
     URL.
   - Set `zoom_client_id` on the workspace and `zoom_client_secret` as a
     secret (`tf_zoom_client_secret`).
   - Press *Connect Zoom user* on Admin Settings → External Connectors, and
     sign in as **the Zoom user who hosts the calendar's meetings**. Zoom
     reports participants only for meetings that user hosts. For any other
     meeting, attendance is marked by hand on the Current tab.
   - A user connected under the old scopes must be reconnected after the
     app's scopes change, or Zoom refuses to report attendance.
   - Zoom rotates the refresh token on every use, and each sync saves the new
     one.

**Moving from the old flow.** Meetings made by the earlier create-a-meeting
version (`google_meetings`) are retired on the first live sync. Their upcoming
calendar invites and Zoom meetings are cancelled, and the rows are deleted.
The "eVals Meetings" calendar that flow made is left on the account; delete it
in Google Calendar if it is no longer wanted. A different Google account can
be connected only once those invites are gone.

Connect an account on **production only**. QA shares the Workspace and the
people, so a live QA sync would send real invites to the real cohort. For that
reason QA's production import deletes the connections, the picked meetings,
the sync log and the live setting.

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
