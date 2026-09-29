# Environments: QA and production

There are two deployments of the app. Both are built from the same
`infra/admin` module, but each is a separate apply with its own project,
database, secrets and identities.

| | **Production** | **QA** |
| --- | --- | --- |
| URL | https://harnessevents.io | https://qa.harnessevents.io |
| GCP admin project | `administration-459416` | `harnessevents-qa` |
| Where its workshop projects go | folder `522401695842` (workshops) | folder `688190860371` (qa-workshops, inside `orchestrator-qa` `158960058878`) |
| Harness IaCM workspace | `admin_control_plane` | `qa_control_plane` |
| Identity that applies it | `tf-admin-sa@administration-459416` (connector `gcp_tf_admin`) | `tf-admin-qa@harnessevents-qa` (connector `gcp_tf_admin_qa`) |
| Identity that builds and deploys it | `build-sa@administration-459416` (connector `gcp_build_sa`) | `build-sa@harnessevents-qa` (connector `gcp_qa_build_sa`) |
| Deployed by | `deploy_production`: run by hand, approved by `prod_deployers` | `deploy_qa`: every push to `main` |
| Workspace OU for attendees | `/` (one OU per run under it) | `/QA` |
| Header badge | none | amber `qa` |

## How a change moves

```
branch ──PR──▶ verify (required check) ──merge──▶ main
                                                   │
                                  deploy_qa (automatic, every push to main)
                                                   │
                                     QA: qa.harnessevents.io
                                                   │
                        deploy_production (by hand; prod_deployers approves)
                                                   │
                                   production: harnessevents.io
```

- **`main` is protected** by the GitHub ruleset `protect-main`. It requires a
  pull request and blocks force-pushes and branch deletion. Repository admins
  (Shawn) can bypass it. Everyone else merges through a PR.
- **Merging deploys QA and nothing else.** `deploy_qa` verifies, applies
  `qa_control_plane`, builds both images into QA's registry, migrates QA's
  database, and rolls QA's Cloud Run.
- **Production is a promotion, not a build.** `deploy_production` copies the
  image `deploy_qa` built from QA's registry into production's, so production
  runs exactly what QA ran. Its preflight refuses a commit that is not on
  `main`, that QA never built, or that is older than what production runs now
  (unless `allow_rollback=true`). It also refuses when `infra/admin/*.tf`
  differs between the commit and the head of `main`, because IaCM always
  applies the head of `main`. After preflight, **every run waits for approval
  from the `prod_deployers` user group**, including runs Shawn starts himself.

Promote whatever QA is serving now:

```
Harness → deploy_production → Run → sha = qa (the default) → approve
```

Roll back production to an older commit that QA built:

```
deploy_production with sha=<older sha>, allow_rollback=true, run_infra=false
```

Rolling back never reverts migrations. That is safe because migrations are
additive: an older image simply ignores newer columns.

## What the two share, and why that matters

Only the GCP side is separate. The rest is shared:

| Shared | Consequence |
| --- | --- |
| Harness account `8mh-FIIHQUapLuB6K0Cd-w` (workshop orgs are created in it) | A QA run creates a real Harness org. The ids carry a run-id suffix, so they never collide with production's. |
| AWS organization OU `ou-soom-m1awl627` | A QA run with AWS creates, and closes, a real AWS account. The number of accounts AWS lets you close is limited, so **prefer no-cloud or GCP runs on QA.** |
| Azure subscription | As with AWS: real resource groups. |
| Google Workspace `harnessevents.io` | QA attendees are real Workspace users, inside `/QA`. |
| Google OAuth client | One client serves both environments. Each environment's callback URL is registered on it. |
| HiBob credentials | Both run the nightly HiBob sync. It is read-only against HiBob. |

Each environment's **Cloud Status** page lists everything in the shared
accounts, so QA shows production's resources as orphans and production shows
QA's. The page is read-only, and these entries are expected.

## Never copy production data into QA

The reaper works from its own database's `workshop_runs` rows. It tears down
the Workspace OU and users, the Harness org, and the cloud accounts those rows
name. Production rows restored into QA's database would give QA's reaper
production's live workshops to destroy, and the shared accounts above mean
nothing stops it. QA's data is created on QA. If a lab guide is needed there,
author it again on QA; do not copy rows, not even "just the content tables".

## Who can do what

| Action | Who | Enforced by |
| --- | --- | --- |
| Merge to `main` | Anyone with write access, through a PR that passes `verify` | GitHub ruleset `protect-main` |
| Push to `main` without a PR | Repository admins (Shawn) | Ruleset bypass list |
| Deploy QA | Anyone who can merge | The `deploy_qa_on_push_main` trigger |
| Run a Harness pipeline | Project group `orchestrator_developers` (Pipeline Executor + Project Viewer) | Harness RBAC |
| Deploy production | Only after `prod_deployers` (Shawn) approves | Approval stage in `deploy_production` |
| Read QA's logs, database and secrets | `developer_members` in `qa_control_plane` | GCP IAM on `harnessevents-qa` |

**Where this is weaker than it looks.** These are the gaps as of 2026-09-29:

- **Harness account administrators** can edit `deploy_production`, delete its
  approval stage, or add themselves to `prod_deployers`. About 18 people have
  that role. The approval gate is only as strong as that list.
- **Group `300@harnessevents.io` holds `roles/owner` on production's GCP
  project.** Any member can deploy with `gcloud` directly and skip Harness
  altogether. Anyone added to that group has production access.
- Anyone with production's `terraform.tfvars` and a Harness PAT can apply
  `admin_control_plane` from a laptop (`scripts/backend-local.sh`).

## Setting QA up from nothing

This was done once, on 2026-09-29. It is recorded here so the steps can be
repeated.

1. `infra/admin/scripts/qa-bootstrap.sh`, run as tf-admin-sa. It creates the
   folders, the project, and `tf-admin-qa` with its key.
2. Create the Harness secret `gcp_tf_admin_qa_key` (file) and connector
   `gcp_tf_admin_qa`, then workspace `qa_control_plane`. It has the same
   repo/path/branch as production and the variables in the table above; the
   secret variables reuse the `tf_*` secrets.
3. First apply of `qa_control_plane`.
4. `qa-bootstrap.sh --grant-billing`, as tf-admin-sa. This grants QA's
   runner-sa `billing.user` and app-sa `billing.viewer`. `tf-admin-qa`
   cannot, because it lacks `billing.admin`, which is why QA sets
   `manage_billing_iam = false`.
5. Mint a key for `build-sa@harnessevents-qa`. Store it as the Harness secrets
   `gcp_qa_build_sa_key` (file) and `gcp_qa_build_sa_key_b64` (text, base64),
   and create connector `gcp_qa_build_sa`.
6. The domain mapping for `qa.harnessevents.io`. Cloud Run only maps a domain
   for an identity that is a **verified owner** of it in Search Console, and
   the only one is `admin@harnessevents.io`. That is who created production's
   mappings. tf-admin-sa is *not* an owner: a mapping it creates sits at
   `DomainRoutable=False / PermissionDenied` forever and holds the name.
   Either:
   - as admin@harnessevents.io in Search Console, add
     `tf-admin-qa@harnessevents-qa.iam.gserviceaccount.com` as an owner of
     `harnessevents.io`, then set `custom_domains = ["qa.harnessevents.io"]`
     on `qa_control_plane` so the mapping lives in code like production's; or
   - as admin@harnessevents.io, run `gcloud beta run domain-mappings create
     --service workshop-orchestrator --domain qa.harnessevents.io --region
     us-central1 --project harnessevents-qa`. It needs Cloud Run admin on
     `harnessevents-qa`; `group:300@harnessevents.io` has owner there.
7. Manual steps outside GCP and Harness:
   - DNS: the records the mapping asks for, which for `qa` are four `A`
     records (`216.239.32.21`, `.34.21`, `.36.21`, `.38.21`) and four `AAAA`
     records (`2001:4860:4802:32::15`, `34::15`, `36::15`, `38::15`), not a
     CNAME. `gcloud beta run domain-mappings describe` lists them.
   - OAuth client: add `https://qa.harnessevents.io/api/auth/callback/google`.
   - Workspace Admin console: create the OU `/QA`, and authorize QA
     runner-sa's numeric client id for domain-wide delegation with scopes
     `https://www.googleapis.com/auth/admin.directory.orgunit` and
     `https://www.googleapis.com/auth/admin.directory.user`.
8. The first `deploy_qa` run finds an empty database. It creates the schema
   with `drizzle-kit push` before applying the `.sql` migrations.
