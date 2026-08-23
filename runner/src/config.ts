import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Cloud } from "./db.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Root of the bundled Terraform tree (runner/terraform). */
export const TF_ROOT = process.env.TF_ROOT ?? path.resolve(here, "../terraform");

/**
 * OpenTofu binary. The runner image ships `tofu`, which is what the committed
 * `.terraform.lock.hcl` files pin providers for. Kept configurable for
 * machines that only have `terraform`.
 */
export const TF_BIN = process.env.TF_BIN ?? "tofu";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

/**
 * Where a workshop's own GCP resources are built — its VPC, and the zonal GKE
 * cluster inside it.
 *
 * Deliberately *not* `GCP_REGION`, which is where the orchestrator's own admin
 * infrastructure lives (the Cloud Run jobs, Cloud SQL) and is what `trigger.ts`
 * addresses the runner job by. The two were one setting until us-central1's
 * GKE node capacity made them need different answers: the admin project cannot
 * move without rebuilding the database, and the workshops have no reason to
 * stay. So the workshops moved to us-west1 — same cheap US pricing tier as
 * us-central1, considerably less contended for the 4-vCPU nodes a workshop
 * cluster wants.
 */
export const region = process.env.GCP_WORKSHOP_REGION ?? "us-west1";

/**
 * Zone letters that exist in each region, for the GKE failover walk.
 *
 * This cannot be one fixed list: the letters are not the same everywhere —
 * us-central1 has an `f` and no `d` or `e`, us-east1 has no `a` at all — so a
 * default of "a,b,c" would send the runner at zones that do not exist in some
 * regions. Anything unlisted falls back to a/b/c, which is right for most
 * regions but worth checking with
 * `gcloud compute zones list --filter="region:<region>"` before pointing the
 * runner somewhere new. `GCP_GKE_ZONES` overrides either way.
 */
const ZONE_LETTERS: Record<string, string[]> = {
  "us-west1": ["a", "b", "c"],
  "us-west2": ["a", "b", "c"],
  "us-west3": ["a", "b", "c"],
  "us-west4": ["a", "b", "c"],
  "us-central1": ["a", "b", "c", "f"],
  "us-east1": ["b", "c", "d"],
  "us-east4": ["a", "b", "c"],
  "us-east5": ["a", "b", "c"],
  "europe-west1": ["b", "c", "d"],
};

/** The zone letters to try, in order: the override if it has any, else the region's. */
function gkeZones(): string[] {
  const override = (process.env.GCP_GKE_ZONES ?? "")
    .split(",")
    .map((z) => z.trim())
    .filter(Boolean);
  return override.length > 0
    ? override
    : (ZONE_LETTERS[region] ?? ["a", "b", "c"]);
}

/**
 * The region part of a zonal location like `us-west1-b`.
 *
 * Used to read back the region a run was actually built in, which is not
 * necessarily the configured one — see `gcpRegionFor` in `run.ts`.
 */
export function regionFromLocation(location: unknown): string | undefined {
  const match =
    typeof location === "string" ? location.match(/^(.+)-[a-z]$/) : null;
  return match?.[1];
}

/**
 * How far ahead of a workshop's scheduled start the scheduler begins
 * provisioning, so attendee accounts and cloud environments are up and running
 * by the time the room opens rather than only starting to build then. Two hours
 * by default; override with `PROVISION_LEAD_HOURS` (fractional hours are fine).
 */
export const PROVISION_LEAD_HOURS = (() => {
  const raw = Number(process.env.PROVISION_LEAD_HOURS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 2;
})();

/**
 * GCP config, read lazily — a workshop that asks for no GCP environment must
 * still be able to provision its Workspace accounts without these set.
 */
export function gcpCfg() {
  return {
    stateBucket: required("GCP_TFSTATE_BUCKET"),
    folderId: required("GCP_WORKSHOPS_FOLDER_ID"),
    billingAccount: required("GCP_BILLING_ACCOUNT_ID"),
    adminProjectId: required("GCP_ADMIN_PROJECT_ID"),
    /**
     * A single long-lived project that no-cloud runs grant their attendees
     * access to instead of provisioning a throwaway one. Optional — only the
     * no-cloud path needs it, so it stays empty unless configured, and that
     * path fails with a clear message rather than a missing-var throw.
     */
    sandboxProjectId: process.env.GCP_SANDBOX_PROJECT_ID ?? "",
    /**
     * Whether each GCP-building run also creates a service account, keys it,
     * and hands the key to Harness as an org secret behind a Google Cloud
     * connector (see `linkGcpToHarness`). Azure and AWS have the same switch.
     *
     * On by default. The off switch exists for an organization that enforces
     * `iam.disableServiceAccountKeyCreation`: there the key create is refused
     * by policy, which would fail the apply that builds the project rather
     * than just skipping the connector. Off, the Terraform creates no account
     * at all and the runner has nothing to upload.
     */
    harnessConnectorEnabled:
      (process.env.GCP_HARNESS_CONNECTOR_ENABLED ?? "true") !== "false",
    /**
     * Project role that service account gets. Owner — the connector is what
     * the workshop's pipelines build through, so it administers the project
     * rather than just reading it.
     */
    harnessSaRole: process.env.GCP_HARNESS_SA_ROLE ?? "roles/owner",
    region,
    /**
     * Ordered zone letters to try for the (zonal) GKE cluster, within
     * {@link region}. GCE capacity stockouts are almost always zone-specific,
     * so on a stockout the runner walks this list until one zone has room
     * rather than failing the workshop (see `applyGkeWithZoneFailover`). The
     * first entry is the default zone every run starts in. Defaults to the
     * zones {@link ZONE_LETTERS} says the region has; override with
     * `GCP_GKE_ZONES` (comma-separated letters, e.g. `b,c,a`).
     *
     * An empty or blank override falls back to the default rather than being
     * honoured: it arrives from Terraform as an unset-meaning empty string,
     * and an empty zone list is not "try nothing", it is a cluster that never
     * gets applied at all.
     */
    gkeZones: gkeZones(),
  };
}

/**
 * The GCS bucket every run's Terraform state lives in, whatever cloud the run
 * targets. It is the orchestrator's own state store (part of its admin infra),
 * not the workshop's cloud — so an Azure- or AWS-only run still needs it, but
 * needs none of the rest of `gcpCfg`.
 */
export function stateBucket(): string {
  return required("GCP_TFSTATE_BUCKET");
}

/**
 * Backend prefix for one cloud within a run's state namespace. GCP keeps the
 * bare per-run prefix it has always used, so runs provisioned before other
 * clouds existed still reap from the same state object; every other cloud gets
 * a subpath, so the states of a run spanning multiple clouds never collide in
 * one bucket object.
 */
export function cloudStatePrefix(base: string, cloud: Cloud): string {
  return cloud === "gcp" ? base : `${base}/${cloud}`;
}

/**
 * Credentials each cloud's providers read straight out of the environment,
 * bypassing this module entirely — which is why nothing else here notices when
 * they are missing.
 */
const CLOUD_CREDENTIAL_ENV: Record<Cloud, string[]> = {
  aws: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
  azure: ["ARM_CLIENT_ID", "ARM_CLIENT_SECRET", "ARM_TENANT_ID"],
  gcp: [], // the runner's own service account, always present on Cloud Run.
};

/**
 * Fail before building anything when a run targets a cloud this deployment has
 * no credentials for.
 *
 * Every deployment is meant to carry all three clouds, but Terraform simply
 * omits the env vars when the AWS/Azure variables are left empty, while the app
 * goes on offering every cloud in the UI. Nothing connects the two, so a
 * half-configured deployment used to surface as a provider error minutes into
 * the apply — after the
 * attendee accounts, the org unit and the Harness projects had all been
 * created, leaving a half-built run to clean up and an error ("No valid
 * credential sources found") that reads like a broken key rather than an
 * absent one.
 *
 * Checked for every selected cloud at once, so a run targeting two
 * misconfigured clouds names both instead of failing twice.
 */
export function assertCloudsConfigured(clouds: Cloud[]): void {
  const missing = clouds.flatMap((cloud) =>
    (CLOUD_CREDENTIAL_ENV[cloud] ?? [])
      .filter((name) => !process.env[name])
      .map((name) => `${cloud}: ${name}`),
  );

  if (missing.length > 0) {
    throw new Error(
      `this deployment has no credentials for the cloud(s) this workshop ` +
        `targets, so nothing was created. Missing ${missing.join(", ")}. ` +
        `Set the matching variables in terraform.tfvars and run \`make infra\` ` +
        `— credentials reach the runner only through a Terraform apply.`,
    );
  }
}

/**
 * AWS config, read lazily like `gcpCfg`. The aws provider reads its management-
 * account credentials from the standard AWS_* env vars itself; the runner only
 * needs the region, where to create accounts, the role to assume into them, and
 * the root-email domain new accounts are registered under.
 */
export function awsCfg() {
  return {
    region: process.env.AWS_REGION ?? "us-east-1",
    /** OU new accounts are created under. Empty means the organization root. */
    parentOuId: process.env.AWS_PARENT_OU_ID ?? "",
    /**
     * Role the management account assumes into each member account to build
     * inside it. AWS creates OrganizationAccountAccessRole in every account it
     * provisions, so that is the default.
     */
    accountAccessRole:
      process.env.AWS_ACCOUNT_ACCESS_ROLE ?? "OrganizationAccountAccessRole",
    /**
     * Every AWS account needs a globally-unique root email, so the runner uses
     * plus-addressing: aws+<account-name>@<domain>. Defaults to the Workspace
     * domain.
     */
    accountEmailDomain:
      process.env.AWS_ACCOUNT_EMAIL_DOMAIN ?? required("GOOGLE_WORKSPACE_DOMAIN"),
    /**
     * Whether each AWS-building run also creates an IAM user in its member
     * account, keys it, and hands the key to Harness behind an AWS connector
     * (see `linkAwsToHarness`). On by default; off, the Terraform creates no
     * user at all.
     */
    harnessConnectorEnabled:
      (process.env.AWS_HARNESS_CONNECTOR_ENABLED ?? "true") !== "false",
    /**
     * Policy that user gets. AdministratorAccess — unlike the other two
     * clouds, the boundary here is a whole member account that is closed at
     * teardown, so administrator inside it reaches nothing that outlives the
     * workshop.
     */
    harnessUserPolicyArn:
      process.env.AWS_HARNESS_USER_POLICY_ARN ??
      "arn:aws:iam::aws:policy/AdministratorAccess",
  };
}

/**
 * Azure config, read lazily like `gcpCfg`. The azurerm/azuread providers read
 * the service-principal credentials from the ARM_ / AZURE_ env vars
 * themselves, so the runner only needs to know which subscription and tenant to
 * build in, where, and which verified domain attendee sign-ins use.
 */
export function azureCfg() {
  return {
    subscriptionId: required("AZURE_SUBSCRIPTION_ID"),
    tenantId: required("AZURE_TENANT_ID"),
    location: process.env.AZURE_LOCATION ?? "eastus",
    /**
     * The app registration the runner signs into Microsoft Graph as, to issue
     * Temporary Access Passes (`graph.ts`). Read from the same `ARM_*` pair the
     * `azuread` provider authenticates with, because it is the same
     * application — it just needs one more Graph permission
     * (`UserAuthenticationMethod.ReadWrite.All`) than creating users took.
     */
    clientId: process.env.ARM_CLIENT_ID ?? "",
    clientSecret: process.env.ARM_CLIENT_SECRET ?? "",
    /**
     * Issue each attendee a Temporary Access Pass alongside their password.
     *
     * On by default, because as of Microsoft's mandatory MFA enforcement a
     * password alone no longer gets an attendee into the Azure portal, and a
     * TAP is the one credential that satisfies it without an authenticator
     * app, a phone, or an enrolment step. Set `AZURE_TAP_ENABLED=false` for a
     * tenant where that enforcement does not apply and the password is enough.
     */
    tapEnabled: (process.env.AZURE_TAP_ENABLED ?? "true") !== "false",
    /**
     * Whether each pass is single-use.
     *
     * Multi-use by default: an attendee who gets signed out halfway through a
     * workshop has to be able to get back in, and a one-time pass leaves them
     * waiting on an organizer to issue another. A one-time pass is the more
     * conservative choice if multi-use turns out not to satisfy the mandatory
     * MFA check in your tenant — test one account before an event and set
     * `AZURE_TAP_ONE_TIME=true` if it does not. The tenant's own TAP policy
     * wins over this either way (see `graph.ts`).
     */
    tapOneTime: (process.env.AZURE_TAP_ONE_TIME ?? "false") === "true",
    /**
     * Attendee UPNs are `<username>@<userDomain>`. Defaults to the Workspace
     * domain so the Azure sign-in string matches the Google one exactly — which
     * requires that domain to be verified in the Entra tenant (a DNS TXT
     * record; it coexists with Google's MX). Override for a tenant that uses a
     * different verified domain.
     */
    userDomain:
      process.env.AZURE_USER_DOMAIN ?? required("GOOGLE_WORKSPACE_DOMAIN"),
    /**
     * Whether each Azure-building run also registers an app of its own, gives
     * it a client secret, and hands that to Harness behind an Azure connector
     * (see `linkAzureToHarness`).
     *
     * On by default. The off switch matters more here than for the other two
     * clouds: registering an application needs a Graph permission
     * (`Application.ReadWrite.OwnedBy`, or the Application Developer role) that
     * creating users did not, so a tenant that has not granted it fails the
     * apply. Off, the Terraform registers nothing.
     */
    harnessConnectorEnabled:
      (process.env.AZURE_HARNESS_CONNECTOR_ENABLED ?? "true") !== "false",
    /**
     * Role that principal is granted on the run's resource group. Owner — the
     * connector is what the workshop's pipelines build through, and the
     * resource group is the per-run boundary, so this grants nothing elsewhere
     * in the subscription.
     */
    harnessSpRole: process.env.AZURE_HARNESS_SP_ROLE ?? "Owner",
  };
}

/**
 * Google Workspace config for attendee account creation. `adminEmail` is the
 * super-admin the runner's service account impersonates via domain-wide
 * delegation; `customerId` defaults to the impersonated account's own customer.
 */
export function workspaceCfg() {
  return {
    domain: required("GOOGLE_WORKSPACE_DOMAIN"),
    adminEmail: required("GOOGLE_WORKSPACE_ADMIN_EMAIL"),
    customerId: process.env.GOOGLE_WORKSPACE_CUSTOMER_ID ?? "my_customer",
    /** OU the per-workshop org units are created under. */
    parentOrgUnitPath: process.env.GOOGLE_WORKSPACE_PARENT_OU ?? "/",
    /**
     * Service account whose Google-managed key signs the delegation assertion
     * (see `directory.ts`). On Cloud Run this is inferred from the job's own
     * identity; set it only when ADC is a human — `gcloud auth
     * application-default login` leaves no service account to infer, and that
     * user then needs serviceAccountTokenCreator on the address given here.
     */
    delegateServiceAccount: process.env.GOOGLE_WORKSPACE_DELEGATE_SA,
  };
}

/**
 * Harness config. Every workshop gets an organization and one project per
 * attendee, so this is read for all runs rather than gated on a cloud.
 *
 * The role and resource-group identifiers are Harness's built-in ("managed")
 * ones. They are overridable because the identifiers are not published in
 * Harness's docs — if an account uses different ones, that is a config change
 * rather than a code change.
 */
export function harnessCfg() {
  return {
    accountId: required("HARNESS_ACCOUNT_ID"),
    apiKey: required("HARNESS_API_KEY"),
    baseUrl: (process.env.HARNESS_BASE_URL ?? "https://app.harness.io").replace(
      /\/+$/,
      "",
    ),
    /*
     * Role and resource-group bindings for the three grants a workshop hands
     * out, mirroring the proven `harnessevents.ps1` reference. Each binding
     * carries a display name alongside its identifier: the identifier is what
     * grants the access, the name is what the role-assignment payload's
     * notification is composed from, and a null name there is dereferenced
     * server-side into a 500 rather than a 400.
     *
     * The account-admin and project-admin roles are Harness built-ins; the
     * org-level attendee role is custom (see `createAttendeeRole`). The
     * reference sends `managedRole: false` for all of them and it works, so the
     * client does the same rather than distinguishing built-in from custom.
     */

    /** Makes the run's creator an administrator of the whole account. */
    accountAdminRole:
      process.env.HARNESS_ACCOUNT_ADMIN_ROLE ?? "_account_admin",
    accountAdminRoleName:
      process.env.HARNESS_ACCOUNT_ADMIN_ROLE_NAME ?? "Account Admin",
    accountAdminResourceGroup:
      process.env.HARNESS_ACCOUNT_ADMIN_RESOURCE_GROUP ??
      "_all_resources_including_child_scopes",
    accountAdminResourceGroupName:
      process.env.HARNESS_ACCOUNT_ADMIN_RESOURCE_GROUP_NAME ??
      "All Resources Including Child Scopes",

    /** Makes each attendee an administrator of their own project. */
    projectAdminRole: process.env.HARNESS_PROJECT_ADMIN_ROLE ?? "_project_admin",
    projectAdminRoleName:
      process.env.HARNESS_PROJECT_ADMIN_ROLE_NAME ?? "Project Admin",
    projectAdminResourceGroup:
      process.env.HARNESS_PROJECT_ADMIN_RESOURCE_GROUP ??
      "_all_project_level_resources",
    projectAdminResourceGroupName:
      process.env.HARNESS_PROJECT_ADMIN_RESOURCE_GROUP_NAME ??
      "All Project Level Resources",

    /**
     * Custom org-level role every attendee is bound to, giving the IDP and
     * core view/access permissions the reference's `attendeeRole` grants. The
     * identifier and name are what `createAttendeeRole` creates and what the
     * org binding then references, so they must agree.
     */
    attendeeRole: process.env.HARNESS_ATTENDEE_ROLE ?? "attendeeRole",
    attendeeRoleName: process.env.HARNESS_ATTENDEE_ROLE_NAME ?? "attendeeRole",
    orgResourceGroup:
      process.env.HARNESS_ORG_RESOURCE_GROUP ??
      "_all_organization_level_resources",
    orgResourceGroupName:
      process.env.HARNESS_ORG_RESOURCE_GROUP_NAME ??
      "All Organization Level Resources",

    /**
     * The event's cloud credentials in Harness: one org-scoped secret per
     * cloud holding what that cloud's connector authenticates with (a service
     * account key file for GCP, a client secret for Azure, a secret access key
     * for AWS), and the org-scoped connector built on it.
     *
     * Every identifier is org-local, so every event gets the same names and a
     * pipeline written against `org.gcp` works in any workshop. The name is
     * what an attendee sees in the connector/secret list; the identifier is
     * what YAML and pipelines reference, so changing it after lab content
     * exists would break that content — hence the settings.
     */
    gcpSecretId: process.env.HARNESS_GCP_SECRET_ID ?? "gcp_service_account",
    gcpSecretName:
      process.env.HARNESS_GCP_SECRET_NAME ?? "GCP Service Account",
    gcpConnectorId: process.env.HARNESS_GCP_CONNECTOR_ID ?? "gcp",
    gcpConnectorName: process.env.HARNESS_GCP_CONNECTOR_NAME ?? "GCP",

    azureSecretId: process.env.HARNESS_AZURE_SECRET_ID ?? "azure_client_secret",
    azureSecretName:
      process.env.HARNESS_AZURE_SECRET_NAME ?? "Azure Client Secret",
    azureConnectorId: process.env.HARNESS_AZURE_CONNECTOR_ID ?? "azure",
    azureConnectorName: process.env.HARNESS_AZURE_CONNECTOR_NAME ?? "Azure",

    awsSecretId: process.env.HARNESS_AWS_SECRET_ID ?? "aws_secret_access_key",
    awsSecretName:
      process.env.HARNESS_AWS_SECRET_NAME ?? "AWS Secret Access Key",
    awsConnectorId: process.env.HARNESS_AWS_CONNECTOR_ID ?? "aws",
    awsConnectorName: process.env.HARNESS_AWS_CONNECTOR_NAME ?? "AWS",

    /**
     * Harness delegates. Each workshop cluster gets one delegate registered at
     * the ORG level (org scope comes from the delegate token). The install is
     * best-effort in the runner, so this whole block is soft: a bad value or a
     * Harness-side blip is logged and the workshop still goes ready.
     */

    /** Off switch — set HARNESS_DELEGATES_ENABLED=false to skip delegates. */
    delegatesEnabled: (process.env.HARNESS_DELEGATES_ENABLED ?? "true") !== "false",
    /**
     * Name of the org-scoped delegate token the runner creates/reuses. One per
     * org, shared by every cluster in the event.
     */
    delegateTokenName:
      process.env.HARNESS_DELEGATE_TOKEN_NAME ?? "workshop-delegate",
    /**
     * Pin the delegate container image. Empty — the normal case — means the
     * runner asks Harness for the version it currently supports, since the
     * Helm chart's default image can be old enough that Harness marks the
     * delegate expired the moment it registers. Set this only to hold a
     * specific image.
     */
    delegateImage: process.env.HARNESS_DELEGATE_IMAGE ?? "",
  };
}

/** Derive a valid, globally-unique GCP project id from a run. */
export function makeProjectId(slug: string, runId: string): string {
  const short = runId.replace(/-/g, "").slice(0, 6);
  const id = `ws-${slug}-${short}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 30)
    .replace(/-+$/, "");
  return id;
}

/**
 * Derive the name of the identity the event's Harness connectors authenticate
 * as: the GCP service account id, the Azure app registration's display name,
 * and the AWS IAM user name are all this one string, so an event's three
 * credentials are recognisably the same event's.
 *
 * Carries the run's short suffix like the cluster name does, and for the same
 * reason: a no-cloud run's service account is created in the one shared sandbox
 * project, where several runs' accounts coexist. Shaped to GCP's rules, which
 * are the tightest of the three — 6-30 characters, starting with a letter and
 * ending with a letter or digit, which the `ws-` prefix and the hex suffix
 * cover at both ends.
 */
export function makeHarnessIdentity(slug: string, runId: string): string {
  const short = runId.replace(/-/g, "").slice(0, 6);
  const suffix = `-${short}`;
  const base = `ws-${slug}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return base.slice(0, 30 - suffix.length).replace(/-+$/, "") + suffix;
}

/**
 * Derive the workshop's GKE cluster name: starts with `k8s-` and reflects the
 * event, with the same short run suffix the project id uses. The suffix keeps
 * two runs from colliding — it matters most for no-cloud runs, which build
 * their clusters in the one shared sandbox project. GKE names must be
 * lowercase, start with a letter, and be at most 40 characters.
 */
export function makeClusterName(slug: string, runId: string): string {
  const short = runId.replace(/-/g, "").slice(0, 6);
  const suffix = `-${short}`;
  const base = `k8s-${slug}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return base.slice(0, 40 - suffix.length).replace(/-+$/, "") + suffix;
}

/**
 * Derive a challenge competitor's own project id. Unlike a workshop, there is
 * one project per account, so the run's suffix alone would collide.
 *
 * Derived from the address rather than the roster position, because a
 * challenge that grows must not renumber — and so recompute the id of — a
 * project that already exists. Project ids are capped at 30 characters, so the
 * slug is truncated to fit whatever the suffixes need.
 */
export function makeChallengeProjectId(
  slug: string,
  runId: string,
  email: string,
): string {
  const short = runId.replace(/-/g, "").slice(0, 4);
  const who = createHash("sha1").update(email).digest("hex").slice(0, 6);
  const suffix = `-${short}-${who}`;

  const base = `ch-${slug}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return base.slice(0, 30 - suffix.length).replace(/-+$/, "") + suffix;
}

/**
 * The address -> project id map a challenge's Terraform root takes. Built the
 * same way on the way in and on the way out, so the reaper tears down exactly
 * the projects the provisioner created without anything extra being stored.
 */
export function challengeProjectMap(
  slug: string,
  runId: string,
  emails: string[],
): Record<string, string> {
  return Object.fromEntries(
    emails.map((email) => [email, makeChallengeProjectId(slug, runId, email)]),
  );
}

/**
 * Azure resource group for a workshop's shared environment — the RG is the
 * per-run isolation boundary, the analog of the GCP project. Same `ws-` shape
 * as `makeProjectId` for readability; RG names permit up to 90 characters.
 */
export function makeResourceGroupName(slug: string, runId: string): string {
  const short = runId.replace(/-/g, "").slice(0, 6);
  return `ws-${slug}-${short}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 90)
    .replace(/-+$/, "");
}

/**
 * A challenge competitor's own resource group. Derived from the address the
 * same way `makeChallengeProjectId` is, so a challenge that grows never
 * renumbers — and so recomputes the name of — an RG that already exists.
 */
export function makeChallengeResourceGroup(
  slug: string,
  runId: string,
  email: string,
): string {
  const short = runId.replace(/-/g, "").slice(0, 4);
  const who = createHash("sha1").update(email).digest("hex").slice(0, 6);
  const suffix = `-${short}-${who}`;
  const base = `ch-${slug}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return base.slice(0, 90 - suffix.length).replace(/-+$/, "") + suffix;
}

/**
 * AWS account name/alias for a workshop's per-run account — the isolation
 * boundary, analog of the GCP project. Lowercase, hyphenated, within AWS's
 * alias rules; same `ws-` shape as `makeProjectId`.
 */
export function makeAwsAccountName(slug: string, runId: string): string {
  const short = runId.replace(/-/g, "").slice(0, 6);
  return `ws-${slug}-${short}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 50)
    .replace(/-+$/, "");
}

/** A challenge competitor's own AWS account name, derived from their address. */
export function makeChallengeAwsAccountName(
  slug: string,
  runId: string,
  email: string,
): string {
  const short = runId.replace(/-/g, "").slice(0, 4);
  const who = createHash("sha1").update(email).digest("hex").slice(0, 6);
  const suffix = `-${short}-${who}`;
  const base = `ch-${slug}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return base.slice(0, 50 - suffix.length).replace(/-+$/, "") + suffix;
}

/** The unique root email an AWS account is registered under (plus-addressed). */
export function awsAccountEmail(accountName: string, domain: string): string {
  return `aws+${accountName}@${domain}`;
}

/**
 * The address -> resource-group map a challenge's Azure root takes, built the
 * same way on provision and teardown so the reaper destroys exactly the RGs the
 * provisioner created — mirrors `challengeProjectMap`.
 */
export function challengeResourceGroupMap(
  slug: string,
  runId: string,
  emails: string[],
): Record<string, string> {
  return Object.fromEntries(
    emails.map((email) => [
      email,
      makeChallengeResourceGroup(slug, runId, email),
    ]),
  );
}
