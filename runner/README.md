# Workshop runner (`tf-runner` / `tf-reaper`)

One container image, two entrypoints, run as **Cloud Run Jobs** under
`runner-sa` (no key files — Terraform uses the job's ADC).

- **`run`** — reads `RUN_ID`, provisions one workshop:
  `provisioning` (Workspace OU + attendee accounts) → `applying`
  (`terraform apply` per requested cloud) → `ready` (outputs + `expires_at`).
  Streams every Terraform line into `run_logs`.
- **`reap`** — finds runs past `expires_at` (or failed) and destroys them:
  `terraform destroy` → project delete → accounts deleted → OU deleted →
  `destroyed`. Cloud Scheduler fires this every few minutes.
- **`provision-due`** — cron entrypoint that claims `scheduled` runs whose start
  time is within the lead window (`PROVISION_LEAD_HOURS`, 2h by default) and
  triggers a `run` execution for each, so environments are ready by the start.

## What a run creates

A run is self-describing: a name, an attendee count, and a set of clouds.

1. **Google Workspace OU** named after the workshop, under
   `GOOGLE_WORKSPACE_PARENT_OU`.
2. **`user_count` accounts** in that OU, named from the adjective/noun lists in
   [`src/usernames.ts`](src/usernames.ts) — `bouncy-penguin@<domain>`, shown in
   Workspace as "Bouncy Penguin". Each address is checked against the Directory
   API before it is claimed, so an account that already exists is never reused;
   if the plain combinations keep colliding a numeric suffix is added. Each gets
   a generated temporary password, stored in `workshop_accounts` for the
   organizer to hand out. No forced reset at first sign-in: the same password is
   copied into the other clouds' accounts, and a reset in one would diverge from
   the rest.
3. **Harness organization** named after the workshop, with **one project per
   attendee** ([`src/harness.ts`](src/harness.ts)). Each attendee is invited as
   an administrator of their own project and as a viewer at the org level, so
   they can see everyone's work but only change their own. This happens for
   every workshop — it is not one of the `clouds`.
4. **Per cloud** — each selected cloud applies its own root, and each builds a
   small Kubernetes cluster for attendees to use:
   - `gcp` → [`terraform/workshops/gcp-base`](terraform/workshops/gcp-base),
     which wires [`modules/project`](terraform/modules/project) to create the
     ephemeral project, link billing, enable APIs, and grant every attendee
     `roles/editor` on it, plus a GKE cluster.
   - `azure` → [`terraform/workshops/azure-base`](terraform/workshops/azure-base):
     one resource group (the isolation boundary), a native Entra user per
     attendee whose UPN and password match their Google account, Contributor on
     the group, and an AKS cluster.
   - `aws` → [`terraform/workshops/aws-base`](terraform/workshops/aws-base): a
     new member account, an IAM user per attendee with PowerUserAccess, and an
     EKS cluster. AWS is the one cloud whose console password is not the shared
     Google one — it generates its own, returned in the run's outputs.

   In `challenge` mode the roots under
   [`terraform/challenges/`](terraform/challenges) build a separate environment
   per competitor instead — a project, resource group, or account each, owned
   solely by that competitor, and no cluster (building one is the challenge).

   GCP keeps the bare per-run state prefix it has always used; every other cloud
   gets a subpath (`cloudStatePrefix`), so a multi-cloud run's states never
   collide in one bucket object.

5. **A Harness connector per cloud** — each cloud's apply also creates an
   identity that administers what it just built, and the runner hands that
   identity's credential to Harness as an org-scoped secret with an org-scoped
   connector on top of it (`linkCloudToHarness`). An attendee's pipelines then
   reach the workshop environment without anyone handling credentials, and
   `org.gcp` / `org.azure` / `org.aws` mean the same thing in every event.

   | Cloud | Identity | Secret | Connector |
   | --- | --- | --- | --- |
   | `gcp` | service account, `roles/owner` on the project ([`modules/harness-sa`](terraform/modules/harness-sa)) | file `gcp_service_account` | `gcp` |
   | `azure` | app registration, Owner on the resource group ([`modules/harness-azure-sp`](terraform/modules/harness-azure-sp)) | text `azure_client_secret` | `azure` |
   | `aws` | IAM user in the member account, AdministratorAccess ([`modules/harness-aws-user`](terraform/modules/harness-aws-user)) | text `aws_secret_access_key` | `aws` |

   All three identities carry the same name (`makeHarnessIdentity`), so an
   event's credentials are recognisably one event's. A no-cloud run gets the GCP
   one in the shared sandbox project. The credentials **never land in the run's
   outputs** — each is stripped after the upload, so none is stored on the run or
   shown in the run page's raw outputs (the GCP service account address, the
   Azure client/tenant id and the AWS access key id do stay: identities, not
   credentials). Teardown deletes all three connectors and secrets, and
   `terraform destroy` deletes the identities — which revokes the credentials
   even where the environment outlives the run, as the sandbox project does.

   Each cloud has an off switch: `GCP_HARNESS_CONNECTOR_ENABLED=false`,
   `AZURE_HARNESS_CONNECTOR_ENABLED=false`, `AWS_HARNESS_CONNECTOR_ENABLED=false`
   — off, that cloud's Terraform creates no identity at all. Two are worth
   knowing about in advance, because in both cases the failure lands *inside the
   apply that builds the environment* rather than merely skipping the connector:
   an organization enforcing `iam.disableServiceAccountKeyCreation` refuses the
   GCP key, and a tenant that has not granted the orchestrator principal
   `Application.ReadWrite.OwnedBy` (or Application Developer) refuses the Azure
   app registration. `GCP_HARNESS_SA_ROLE`, `AZURE_HARNESS_SP_ROLE`, and
   `AWS_HARNESS_USER_POLICY_ARN` change how much each identity is granted;
   `HARNESS_<CLOUD>_SECRET_ID` / `HARNESS_<CLOUD>_CONNECTOR_ID` (and their
   `_NAME` counterparts) change what the pair is called — the identifiers are
   what lab content references, so changing them after content exists breaks it.

   Challenge mode is not covered: its competitors each own a separate
   environment, and one org connector cannot stand for all of them.

6. **Harness delegate per cluster** — after the clusters are up, an org-scoped
   delegate is Helm-installed into each ([`delegates/`](terraform/delegates)).
   Best-effort: a delegate that will not install is logged and the workshop
   still goes ready. Teardown is implicit — destroying the cluster takes it.
   The image is the version Harness reports as current, looked up per run
   (`latestDelegateImage`), because the chart's default image trails the
   delegate release by months and Harness expires a delegate six months out —
   long enough that the chart default can register already-expired. Set
   `HARNESS_DELEGATE_IMAGE` to pin a specific image instead.

Harness identifiers can't contain hyphens and must not collide with reserved
words, so names are put through `harnessIdentifier()` rather than reusing the
slug: the workshop "Team Onboarding — East" becomes `Team_Onboarding_East_<run>`
and `bouncy-penguin` becomes project `bouncy_penguin`. The org identifier
carries a slice of the run id because organization identifiers must be unique
across the whole Harness account and two workshops may share a name. Nothing
extra is stored — teardown re-derives both identifiers the same way.

Terraform state is per-run in the admin bucket
(`-backend-config=prefix=<state_prefix>`).

## Env

`DATABASE_URL`, `GCP_TFSTATE_BUCKET`, `GCP_WORKSHOPS_FOLDER_ID`,
`GCP_BILLING_ACCOUNT_ID`, `GCP_ADMIN_PROJECT_ID`, `GCP_REGION`,
`GOOGLE_WORKSPACE_DOMAIN`, `GOOGLE_WORKSPACE_ADMIN_EMAIL`,
`GOOGLE_WORKSPACE_PARENT_OU`, `HARNESS_ACCOUNT_ID`, `HARNESS_API_KEY`,
`HARNESS_BASE_URL` — all supplied by the Cloud Run Job definitions in
`infra/admin/runner.tf` (`DATABASE_URL` and `HARNESS_API_KEY` from Secret
Manager). `TF_BIN` overrides the OpenTofu binary (defaults to `tofu`; set to
`terraform` on a machine that only has that).

Two regions, deliberately. `GCP_REGION` is where the control plane itself runs
— it addresses the Cloud Run job this process triggers, and it is where Cloud
SQL and the state bucket live. `GCP_WORKSHOP_REGION` (default `us-west1`) is
where a workshop's own VPC and GKE cluster are built; it moved off us-central1
because that region runs out of GKE node capacity too often to hold a room up
on. A run that is already built stays in the region it was built in — the
subnet and cluster are regional placements, and Terraform's answer to a moved
placement is destroy-and-recreate — so the change only takes effect for new
runs. `GCP_GKE_ZONES` overrides the zone letters the capacity failover walks;
blank means "use the runner's list for that region" (`config.ts`).

The image ships **OpenTofu**, not Terraform, because the committed
`.terraform.lock.hcl` files pin providers from `registry.opentofu.org`.
Terraform resolves the same providers from `registry.terraform.io`, so running
it here would leave those pins inert and re-resolve providers on every init.

`HARNESS_ACCOUNT_ID` and `HARNESS_API_KEY` are required for **every** run,
since each workshop provisions Harness. The built-in role and resource-group
identifiers default to `_project_admin` / `_all_project_level_resources` and
`_organization_viewer` / `_all_organization_level_resources`; override them with
`HARNESS_PROJECT_ADMIN_ROLE`, `HARNESS_PROJECT_ADMIN_RESOURCE_GROUP`,
`HARNESS_ORG_VIEWER_ROLE`, and `HARNESS_ORG_VIEWER_RESOURCE_GROUP` if the
account uses different ones.

Azure adds `AZURE_SUBSCRIPTION_ID`, `AZURE_TENANT_ID`, `AZURE_LOCATION`, and
optionally `AZURE_USER_DOMAIN` (the verified domain attendee UPNs use, defaulting
to the Workspace domain so the Azure sign-in string matches the Google one). The
`azurerm`/`azuread` providers authenticate themselves from `ARM_SUBSCRIPTION_ID`,
`ARM_TENANT_ID`, `ARM_CLIENT_ID`, and `ARM_CLIENT_SECRET` (the last from Secret
Manager). AWS adds `AWS_REGION`, `AWS_PARENT_OU_ID`, `AWS_ACCOUNT_ACCESS_ROLE`,
and `AWS_ACCOUNT_EMAIL_DOMAIN`, with the provider reading `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY`.

Every cloud's vars are read lazily, so a workshop only touches the credentials
of the clouds it selected — a GCP-only run never reads the Azure or AWS ones.
That is an isolation property, not a licence to skip them: all three sets belong
in every deployment, and a run that selects a cloud whose vars are missing fails
its preflight naming them.

### Workspace access

The Directory API rejects service accounts acting as themselves, so `runner-sa`
needs **domain-wide delegation** in the Workspace admin console for:

```
https://www.googleapis.com/auth/admin.directory.orgunit
https://www.googleapis.com/auth/admin.directory.user
```

and impersonates `GOOGLE_WORKSPACE_ADMIN_EMAIL` (a super-admin).

## No second factor, anywhere

A workshop account exists for a few hours, is read off a slide, and is deleted
with the run. Nothing here asks an attendee for a second factor or a password
change: `changePasswordAtNextLogin` is off in `directory.ts` and
`force_password_change` is off on the Entra users, both so the one issued
password keeps working across every cloud the workshop selected.

Entra is the exception, and not because of anything provisioned here. A tenant
with **security defaults** on — the default since late 2019 — makes every new
user enrol in Microsoft Authenticator, which lands a room of thirty people on a
QR code before they have done anything. It is a tenant setting, invisible to
the `azuread` provider (there is no resource for it), so it has to be turned
off once, out of band:
[`infra/admin/scripts/azure-no-mfa.sh`](../infra/admin/scripts/azure-no-mfa.sh)
reports it, turns it off with `APPLY=1`, lists the Conditional Access policies
that would keep prompting anyway, and explains the one prompt — Microsoft's
mandatory MFA on Azure portal sign-ins — that no tenant setting removes.

Google Workspace is worth checking at the same time if attendees hit a prompt
there too: 2-Step Verification enrolment is off unless an admin turned it on
(Admin console → Security → Authentication → 2-Step Verification), and because
attendee Harness access is Google SSO, a Workspace prompt gates Harness as well
as GCP.

### The Azure portal, which enforces MFA regardless

None of the above reaches the one prompt that matters: Microsoft enforces MFA on
sign-ins to the Azure portal tenant-wide, above Conditional Access and
independent of security defaults, and there is no setting to switch it off. A
password alone no longer gets an attendee in.

So each attendee gets a **Temporary Access Pass** — an admin-issued,
time-limited passcode that satisfies the MFA requirement with nothing to
install and nothing to enrol. They type it where the password would go.
[`src/graph.ts`](src/graph.ts) issues one per attendee immediately after the
Azure apply (the pass needs a user that already exists), and it lands in
`workshop_accounts.azure_access_pass`, shown on both the attendee page and the
organizer's run view. Entra returns a pass exactly once, at creation, which is
why it is stored rather than re-read.

Three things this depends on, all outside the code:

- **`UserAuthenticationMethod.ReadWrite.All`**, admin-consented, on the same app
  registration the `azuread` provider already uses.
- **The Temporary Access Pass method enabled** in the tenant (Entra admin
  center → Protection → Authentication methods). If it is off, the run logs
  that and issues nothing.
- **A maximum lifetime longer than the workshop.** The runner asks for the
  workshop's TTL plus the provisioning lead, then clamps to the tenant's
  configured bounds — a request outside them is simply rejected — and logs when
  the cap cut it short.

Issuance is best-effort: a pass that fails to issue is logged against the
address it belongs to and the run still goes ready, because the attendee still
has a working account and every other cloud in the workshop. A run whose passes
did not issue is a room that cannot sign into Azure, so the failures are loud.

`AZURE_TAP_ENABLED=false` turns the whole thing off for a tenant that does not
enforce this. `AZURE_TAP_ONE_TIME=true` makes each pass single-use; the default
is reusable, so an attendee who gets signed out mid-workshop can get back in
without an organizer. **Test one account before an event** — if a reusable pass
is not accepted as MFA in your tenant, single-use is the fallback. The tenant's
own policy overrides both (a tenant that mandates single-use passes wins).

## Build & push

```bash
REPO=us-central1-docker.pkg.dev/<admin-project>/workshop-orchestrator
docker build -t $REPO/runner:latest .
docker push $REPO/runner:latest
# then set runner_image in infra/admin/terraform.tfvars and re-apply
```
