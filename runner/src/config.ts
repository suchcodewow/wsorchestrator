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

export const region = process.env.GCP_REGION ?? "us-central1";

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
    region,
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
     * Attendee UPNs are `<username>@<userDomain>`. Defaults to the Workspace
     * domain so the Azure sign-in string matches the Google one exactly — which
     * requires that domain to be verified in the Entra tenant (a DNS TXT
     * record; it coexists with Google's MX). Override for a tenant that uses a
     * different verified domain.
     */
    userDomain:
      process.env.AZURE_USER_DOMAIN ?? required("GOOGLE_WORKSPACE_DOMAIN"),
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
