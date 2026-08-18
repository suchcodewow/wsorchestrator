# Admin-project Terraform (control plane)

Stands up everything durable in the **admin project**: the Terraform state
bucket, Cloud SQL, service accounts + IAM (folder/billing scoped), Secret
Manager, Artifact Registry, the Cloud Run app service, and the
`tf-runner` / `tf-reaper` Cloud Run Jobs + reaper schedule.

Ephemeral **workshop projects** are created at runtime by `tf-runner` — they are
not managed here.

## What gets created

| File | Resources |
| --- | --- |
| `apis.tf` | Enables required APIs on the admin project |
| `state.tf` | GCS bucket for per-run workshop state |
| `iam.tf` | `runner-sa`, `app-sa`, `scheduler-sa` + role bindings |
| `database.tf` | Cloud SQL (Postgres 16), `workshops` DB, `appuser` |
| `secrets.tf` | Secret Manager: DB URL, auth secret, Google OAuth |
| `registry.tf` | Artifact Registry Docker repo |
| `runner.tf` | `tf-runner` + `tf-reaper` Cloud Run Jobs |
| `app.tf` | Cloud Run service (Next.js app), public invoker |
| `scheduler.tf` | Cloud Scheduler → reaper job |

## IAM model (the important part)

- **`runner-sa`** — `roles/owner` **on the workshops folder** (broad inside the
  sandbox, powerless outside it), plus `projectCreator`, `projectDeleter`,
  `serviceUsageAdmin` on the folder, `billing.user` on the billing account,
  `storage.objectAdmin` on the state bucket, and `cloudsql.client` +
  `logging.logWriter` on the admin project.
- **`app-sa`** — `cloudsql.client`, `logging.logWriter`, `secretAccessor` on the
  app secrets, and `run.invoker` on the `tf-runner` job. **No** project-creation
  power.
- **`scheduler-sa`** — `run.invoker` on the `tf-reaper` job only.

## Prerequisites

- The admin project exists and your identity has, at the org/folder level:
  `resourcemanager.folderIamAdmin` (to grant folder roles) and
  `billing.admin` on the billing account (to grant `billing.user`).
- The `workshops` folder exists; you have its numeric ID.
- `gcloud` authenticated (`gcloud auth application-default login`), `terraform`
  and `gcloud` on PATH.

## Deploy

```bash
cd infra/admin
cp terraform.tfvars.example terraform.tfvars   # fill in values (see Configuration)

# 1) Bootstrap this config's own state bucket + backend init
ADMIN_PROJECT=<admin> REGION=us-central1 \
  STATE_BUCKET=<admin>-infra-tfstate ./scripts/bootstrap.sh

# 2) Review + apply (uses placeholder images the first time)
terraform plan  -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars
```

The first apply uses the public `cloudrun/hello` image for the app and runner so
everything stands up cleanly. In **step #3** you'll build the real images, push
them to the Artifact Registry repo (see the `artifact_registry` output), set
`app_image` / `runner_image` in `terraform.tfvars`, and re-apply.

## Configuration

Every variable lives in `terraform.tfvars` (copy `terraform.tfvars.example`).
This section is the reference for what each group needs; the example file
carries only the shape of the values.

### Control plane

`region` is where the control plane itself runs — Cloud Run, Cloud SQL,
Artifact Registry, GCS. `workshop_region` is where each workshop's own VPC and
GKE cluster are built, and it is deliberately separate: the control plane
cannot move without rebuilding the database, whereas workshops can, and
us-central1 runs out of GKE node capacity too often to build rooms in.

`gke_zones` overrides the zone letters the runner walks within that region on a
capacity stockout; empty means the runner's built-in list.

### Google Workspace

Attendee accounts are created here. `runner-sa` needs **domain-wide
delegation** for `admin.directory.orgunit` + `admin.directory.user`, and
impersonates `workspace_admin_email`, which must be a super-admin.

### Harness

Each workshop becomes an organization, with one project per attendee. The API
key needs org and project create rights plus user invite.

### Azure

Required, like every cloud here — fill the block in. All four values come from
one service principal, which needs permissions on **two planes**:

- **Azure RBAC** (subscription scope): `Owner` is simplest. `Contributor` is
  **not** enough — it cannot create the role assignments this provisions, and
  cannot grant the `Owner` that challenge mode gives competitors. The
  least-privilege alternative is `Contributor` + `User Access Administrator`.
- **Microsoft Graph** (application permissions, admin-consented):
  - `User.ReadWrite.All` — create attendee Entra users.
  - `UserAuthenticationMethod.ReadWrite.All` — issue each of them a Temporary
    Access Pass, which is what they actually sign into the portal with, because
    Microsoft enforces MFA there and refuses a password alone. Without this
    permission the run still succeeds and says so in its log, but nobody can
    sign into Azure.

```bash
az ad sp create-for-rbac --role Owner --scopes /subscriptions/<SUB_ID>
# then add the Graph permission and:
az ad app permission admin-consent --id <APP_ID>
```

Also verify the Workspace domain in the tenant (DNS TXT) so attendee UPNs match
their Google address. `azure_client_secret` is stored in Secret Manager; the
rest are plaintext env on the runner.

Two further tenant-level steps, or attendees are made to enrol in Microsoft
Authenticator on their first sign-in:

1. Turn Entra's security defaults **off**. `az login` as a Global Admin, then
   `APPLY=1 ./scripts/azure-no-mfa.sh` — which also reports the Conditional
   Access policies and the registration campaign.
2. Enable Temporary Access Pass (Entra admin center → Protection →
   Authentication methods → Temporary Access Pass) and raise its maximum
   lifetime past the length of a workshop. This is what answers Microsoft's
   mandatory MFA on portal sign-in, which no setting can switch off.

`AZURE_TAP_ENABLED=false` on the runner turns pass issuance off for a tenant
that does not need it.

### AWS

Required, like every cloud here — fill the block in. `aws_access_key_id` is
what the config gates on: leave it empty and the credentials are left off the
runner entirely, and every run that selects AWS fails its preflight with the
missing variables named. That path exists to make a half-configured deployment
fail loudly, not as a supported way to deploy.

The credentials belong to the Organizations **management account** and need
rights to create member accounts and to assume `OrganizationAccountAccessRole`
into them: `organizations:CreateAccount`, `DescribeCreateAccountStatus`,
`MoveAccount`, `TagResource`, `CloseAccount` (teardown), and `sts:AssumeRole`
on `arn:aws:iam::*:role/OrganizationAccountAccessRole`. Everything built inside
a member account goes through that assumed role, which is already admin.

Create them in the management account, with the AWS CLI authenticated as
someone who can administer the organization and IAM:

```bash
# 0) The organization has to exist, with all features (consolidated billing
#    alone cannot create accounts).
aws organizations describe-organization \
  || aws organizations create-organization --feature-set ALL

# 1) The policy: organization rights, plus the hop into each member account.
cat > workshop-orchestrator.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "organizations:CreateAccount",
        "organizations:DescribeCreateAccountStatus",
        "organizations:DescribeAccount",
        "organizations:DescribeOrganization",
        "organizations:ListAccounts",
        "organizations:ListParents",
        "organizations:ListRoots",
        "organizations:ListTagsForResource",
        "organizations:MoveAccount",
        "organizations:TagResource",
        "organizations:UntagResource",
        "organizations:CloseAccount"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "arn:aws:iam::*:role/OrganizationAccountAccessRole"
    }
  ]
}
JSON

aws iam create-policy --policy-name WorkshopOrchestrator \
  --policy-document file://workshop-orchestrator.json

# 2) A user to carry it. No console access — this identity is only ever the
#    runner's static key pair.
aws iam create-user --user-name workshop-orchestrator
aws iam attach-user-policy --user-name workshop-orchestrator \
  --policy-arn arn:aws:iam::<MGMT_ACCOUNT_ID>:policy/WorkshopOrchestrator

# 3) The key pair itself. `SecretAccessKey` is shown once and never again.
aws iam create-access-key --user-name workshop-orchestrator
```

`AccessKeyId` and `SecretAccessKey` from the last command are
`aws_access_key_id` and `aws_secret_access_key`. For an OU to park workshop
accounts in rather than the organization root:

```bash
ROOT=$(aws organizations list-roots --query 'Roots[0].Id' --output text)
aws organizations create-organizational-unit --parent-id "$ROOT" --name Workshops
```

and put the resulting `ou-...` id in `aws_parent_ou_id`; empty creates accounts
at the root. The access key id and secret are stored in Secret Manager; region
and OU are plaintext.

One mailbox has to exist before any of this works. Every AWS account needs a
globally-unique root email, so the runner plus-addresses them as
`aws+<account-name>@<domain>` — `aws_account_email_domain`, or the Workspace
domain when that is empty. AWS mails account verification there, and it is the
only route to a root password reset later, so `aws@<domain>` must be a real
deliverable address; Gmail and Workspace fold every `+` variant into it, so one
mailbox catches them all.

Two costs worth knowing before choosing AWS: EKS is ~$0.10/hr per cluster with
no free tier, and closing a member account suspends it for ~90 days before AWS
frees it. It is the pricier, slower-to-reap cloud. That second one meets a quota
— a young organization is allowed only a handful of member accounts, and
suspended ones still count — so raise the account limit through Support well
before a workshop needs the headroom.

### Google OAuth

Create the client under APIs & Services → Credentials in the admin project, and
add `<app_url>/api/auth/callback/google` as an authorized redirect URI.

After the first apply, set `app_url` to the `app_url` output and re-apply, so
Auth.js pins `AUTH_URL` — Google rejects the guessed `0.0.0.0` redirect_uri
that Cloud Run's host detection otherwise produces.

### Site roles

Everyone who signs in is an **operator**. **Managers** see and can delete every
user's events; **administrators** also hand out roles. Because roles are granted
from inside the app, the first administrator has to come from here: anyone
listed becomes one when they sign in. Can be emptied once one exists.

### Custom domains

Empty (the default) skips domain mapping. Each domain gets its own Cloud Run
mapping and managed TLS certificate; after applying, add the records from the
`domain_dns_records` output at your registrar.

Whichever domain `app_url` points at is canonical — the rest 308-redirect to
it. That is not cosmetic: Auth.js pins one `AUTH_URL` and Google matches the
OAuth redirect_uri exactly, so sign-in only works on a single origin.

### Tuning

`db_tier` defaults to `db-custom-1-3840`, the smallest valid Postgres tier.
`reaper_schedule` destroys runs past their TTL and `scheduler_schedule` starts
runs whose start time has arrived; both default to every five minutes.

### Container images

These are the images the Cloud Run resources are **created** with. After that
they are ignored — the running tag is owned by `make deploy` / the CD trigger,
not Terraform (see the `lifecycle` blocks in `app.tf` and `runner.tf`), so
changing them on an existing deployment does nothing. Roll with
`make deploy TAG=<sha>` instead.

### Continuous deployment

Push to main builds, migrates, and rolls Cloud Run. Leave `enable_cicd = false`
(the default) until both manual steps are done; nothing in `cicd.tf` is created
while it is off.

1. Install the [Cloud Build GitHub App](https://github.com/apps/google-cloud-build)
   on the repo, then take the installation id from the URL it redirects to
   (`.../installations/<ID>`).
2. Store a classic PAT (scopes: `repo`, `read:user`) in Secret Manager:

   ```bash
   printf '%s' <TOKEN> | gcloud secrets create github-pat \
     --data-file=- --project my-admin-project
   ```

## Outputs

`terraform output` gives you the app URL, the DB connection name (for
`cloud-sql-proxy` during local migrations), the state bucket, the Artifact
Registry path, and the SA emails.

## Notes

- `deletion_protection = false` and no DB backups: this is the **testing**
  posture. Turn both on before anything real.
- Cloud SQL has a public IP but **no authorized networks** — reach it only via
  the connector socket (Cloud Run) or `cloud-sql-proxy` locally.
