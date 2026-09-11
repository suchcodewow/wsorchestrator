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

**`AUTH_URL` must be pinned** via the `app_url` variable. Left to guess its own
host, Cloud Run produces a `0.0.0.0:8080` `redirect_uri` that Google rejects.

**Cloud SQL Postgres needs `edition=ENTERPRISE` + `db-custom-1-3840`.** The
shared-core `db-f1-micro` is MySQL-only, and `ENTERPRISE_PLUS` rejects custom
tiers.

**Environment variables reach Cloud Run only through the infrastructure apply.**
`make ship` and the deploy pipeline's build stage run `gcloud run services
update --image`, which swaps the image and leaves the environment untouched. So
a new or changed `SITE_ADMIN_EMAILS` — or any env var — needs the OpenTofu
apply, not a rebuild. `terraform.tfvars` is git-ignored, so the value lives only
on the machine that applies it.

```bash
make infra     # prompts for yes
# non-interactively:
tofu -chdir=infra/admin apply -var-file=terraform.tfvars -auto-approve
```

Terraform declares `ignore_changes` on the app image, so an apply does **not**
revert a pipeline-deployed image. Verified: revisions share the same digest.

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
`workshop-orchestrator` user's static keys, which live only in the git-ignored
`infra/admin/terraform.tfvars`.

That login is the CLI-v2 root-session flow (`login_session = arn:...:root` in
`~/.aws/config`, cache under `~/.aws/login`), and **the OpenTofu AWS provider
cannot read it**. A local `tofu plan/apply/destroy` against AWS dies with "No
valid credential sources found" until static `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` are exported. State-only commands (`tofu state list`,
`tofu state rm`) work without them.

---

## Known issues

### AWS member accounts are never activated (open since 2026-09-02)

Every AWS workshop run fails. The member account is created and reads `ACTIVE`
in Organizations, `OrganizationAccountAccessRole` assumes fine, IAM works — but
no other service is ever subscribed. Not a warm-up delay; still true hours
later.

| Service | Error |
| --- | --- |
| EC2 | `OptInRequired` |
| S3 | `NotSignedUp` |
| EKS | `SubscriptionRequiredException` |

That triple is the signature of an AWS account whose sign-up never completed.

**The evidence:** matching `aws_organizations_account.this: Creation complete`
to `module.eks.aws_vpc.this: Creation complete` in Cloud Logging, 6 of 6 runs
got a VPC about 81 seconds after account creation through 2026-08-27, and 0 of 3
have since 2026-09-02 (accounts `143853720355`, `064437474572`, `577331852365`).

**No code change caused it and no code change fixes it.** This needs an AWS
Support case against management account `654129064688`. Best guess, unproven:
the org holds 13 accounts, 11 `SUSPENDED`, 9 closed since 2026-08-18; AWS caps
closures at 10% of an org per 30 days and closed accounts hold their slot about
90 days, so the account-vending pipeline is likely held. It cannot be confirmed
from here — the `workshop-orchestrator` IAM user is denied
`list-create-account-status`, service quotas, and SCP reads.

**Two consequences in the code, worth knowing while this is open:**

1. `AWS_ACCOUNT_WARMUP_SIGNATURES` in
   [runner/src/classify.ts](../runner/src/classify.ts) matches `optinrequired`,
   so the runner spends 5 attempts and about 11 minutes treating a permanent
   state as a timing race, then reports a generic failure. The real cause never
   surfaces in the run log.
2. `sts:AssumeRole` into a `SUSPENDED` account fails and the AWS provider
   silently falls back to management credentials. That is the source of
   `role_arn is required, but no definition was found` and
   `AccessDenied … user/workshop-orchestrator` in reaper teardowns, retried
   every 5 minutes indefinitely.

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
