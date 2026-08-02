import fs from "node:fs";
import path from "node:path";
import { awsCfg, azureCfg, gcpCfg } from "./config.js";

/** Labels/tags stamped on every managed resource, in every cloud. */
function labels(runId: string) {
  return {
    managed_by: "workshop-orchestrator",
    run_id: runId.replace(/-/g, "").slice(0, 12),
  };
}

/** Settings every GCP root config takes, regardless of event mode. */
function commonVars(runId: string) {
  const cfg = gcpCfg();
  return {
    folder_id: cfg.folderId,
    billing_account: cfg.billingAccount,
    region: cfg.region,
    admin_project_id: cfg.adminProjectId,
    run_id: runId,
    labels: labels(runId),
  };
}

/** Settings both Azure root configs take. */
function azureCommonVars(runId: string) {
  const cfg = azureCfg();
  return {
    subscription_id: cfg.subscriptionId,
    tenant_id: cfg.tenantId,
    location: cfg.location,
    run_id: runId,
    labels: labels(runId),
  };
}

/** Settings both AWS root configs take. */
function awsCommonVars(runId: string) {
  const cfg = awsCfg();
  return {
    region: cfg.region,
    parent_ou_id: cfg.parentOuId,
    account_access_role: cfg.accountAccessRole,
    run_id: runId,
    labels: labels(runId),
  };
}

function write(workDir: string, vars: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(workDir, "terraform.tfvars.json"),
    JSON.stringify(vars, null, 2),
  );
}

/**
 * Write the per-run terraform.tfvars.json into a workshop root dir.
 * Each job execution owns its container, so mutating the dir in place is safe.
 *
 * `attendeeEmails` are the accounts the runner created in Workspace just
 * beforehand; Terraform grants each of them editor on the single shared
 * project. Passing the full list (not just newly added ones) keeps the apply
 * convergent when a workshop grows.
 */
export function writeTfvars(
  workDir: string,
  projectId: string,
  runId: string,
  attendeeEmails: string[] = [],
  clusterName?: string,
) {
  write(workDir, {
    ...commonVars(runId),
    project_id: projectId,
    attendee_emails: attendeeEmails,
    // gcp-base and gcp-sandbox both build a GKE cluster and require this;
    // it is deterministic in (slug, runId), so provision and teardown pass the
    // same name and Terraform tears down exactly what it created.
    ...(clusterName ? { cluster_name: clusterName } : {}),
  });
}

/**
 * Write terraform.tfvars.json for a challenge, whose root config creates one
 * project per competitor instead of one for the whole event.
 *
 * `attendeeProjects` maps each address to the project id it owns. As with a
 * workshop, the whole roster is passed every time so that growing a challenge
 * converges — the entries already in state are unchanged and only the new
 * competitor's project is added.
 */
export function writeChallengeTfvars(
  workDir: string,
  runId: string,
  attendeeProjects: Record<string, string>,
) {
  write(workDir, {
    ...commonVars(runId),
    attendee_projects: attendeeProjects,
  });
}

/**
 * Write terraform.tfvars.json for a workshop's Azure environment: the shared
 * resource group, the AKS cluster, and the attendee address -> temp-password
 * map Terraform turns into native Entra users. The whole roster is passed every
 * apply so a grown workshop converges, exactly like the GCP writers.
 */
export function writeAzureTfvars(
  workDir: string,
  runId: string,
  resourceGroupName: string,
  clusterName: string,
  attendees: Record<string, string>,
) {
  write(workDir, {
    ...azureCommonVars(runId),
    resource_group_name: resourceGroupName,
    cluster_name: clusterName,
    // Emails drive Terraform's for_each; passwords are a separate sensitive map
    // it only looks up (a sensitive value cannot be a for_each key).
    attendee_emails: Object.keys(attendees),
    attendee_passwords: attendees,
  });
}

/**
 * Write terraform.tfvars.json for a challenge's Azure environment: one resource
 * group per competitor and the same address -> temp-password map. No cluster —
 * the challenge root builds none.
 */
export function writeAzureChallengeTfvars(
  workDir: string,
  runId: string,
  attendeeResourceGroups: Record<string, string>,
  attendees: Record<string, string>,
) {
  write(workDir, {
    ...azureCommonVars(runId),
    attendee_resource_groups: attendeeResourceGroups,
    attendee_passwords: attendees,
  });
}

/**
 * Write terraform.tfvars.json for a workshop's AWS environment: the per-run
 * account, the EKS cluster, and the attendee addresses Terraform turns into IAM
 * users. No passwords in — AWS generates its own and returns them in outputs.
 */
export function writeAwsTfvars(
  workDir: string,
  runId: string,
  accountName: string,
  accountEmail: string,
  clusterName: string,
  attendeeEmails: string[],
) {
  write(workDir, {
    ...awsCommonVars(runId),
    account_name: accountName,
    account_email: accountEmail,
    cluster_name: clusterName,
    attendee_emails: attendeeEmails,
  });
}
