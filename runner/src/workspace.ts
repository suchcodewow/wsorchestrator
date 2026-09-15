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

/**
 * Settings every GCP root config takes, regardless of event mode.
 *
 * `region` defaults to the configured one but is overridable, because a run
 * that is already built is pinned to the region it was built in — see
 * `gcpRegionFor` in `run.ts`.
 */
function commonVars(runId: string, region?: string) {
  const cfg = gcpCfg();
  return {
    folder_id: cfg.folderId,
    billing_account: cfg.billingAccount,
    region: region ?? cfg.region,
    admin_project_id: cfg.adminProjectId,
    run_id: runId,
    labels: labels(runId),
  };
}

/**
 * Settings the GCP layers that build *into* already-created projects take — the
 * challenge cluster layer and every scenario root.
 *
 * Deliberately smaller than `commonVars`: these layers create no projects, so
 * they have no use for the folder, the billing account or the admin project,
 * and passing values a root does not declare is a warning on every apply. It
 * also keeps the `variables.tf` a scenario author copies down to what a
 * scenario genuinely takes.
 */
function gcpLayerVars(runId: string, region: string) {
  return {
    region,
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
 * Write the tfvars for a delegate root (delegates/gke|aks|eks). These take a
 * flat, cloud-specific set of values assembled by the runner rather than the
 * shared cloud config, so — unlike the workshop roots — this is a thin pass-
 * through with no `commonVars`.
 */
export function writeDelegateTfvars(
  workDir: string,
  vars: Record<string, unknown>,
) {
  write(workDir, vars);
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
  {
    clusterName,
    zoneLetter,
    region,
    serviceAccountId,
  }: {
    /**
     * gcp-base and gcp-sandbox both build a GKE cluster and require this; it
     * is deterministic in (slug, runId), so provision and teardown pass the
     * same name and Terraform tears down exactly what it created.
     */
    clusterName?: string;
    /**
     * Which zone of the region hosts the zonal GKE cluster. Omitted on
     * teardown (destroy works off state, so the zone the cluster was built in
     * is already recorded) and on the first apply the runner sets it as it
     * walks zones to dodge capacity stockouts (see
     * `applyGkeWithZoneFailover`).
     */
    zoneLetter?: string;
    /** The region a built run is pinned to, when it is not the configured one. */
    region?: string;
    /**
     * The service account the event's Harness Google Cloud connector
     * authenticates as. Deterministic in (slug, runId), so provision and
     * teardown name the same account. Omitted — or empty, when the connector
     * is switched off — creates none, which is also what every run built
     * before this existed has in its state.
     */
    serviceAccountId?: string;
  } = {},
) {
  write(workDir, {
    ...commonVars(runId, region),
    project_id: projectId,
    attendee_emails: attendeeEmails,
    service_account_id: serviceAccountId ?? "",
    service_account_role: gcpCfg().harnessSaRole,
    ...(clusterName ? { cluster_name: clusterName } : {}),
    ...(zoneLetter ? { zone_letter: zoneLetter } : {}),
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
  /**
   * APIs to enable in each competitor's project: the baseline plus whatever the
   * selected scenarios need (`activateApisFor`). Omitted, the root's own default
   * applies — which is the bare-challenge baseline, so a challenge with no
   * scenarios builds exactly what it built before scenarios existed.
   */
  activateApis?: string[],
) {
  write(workDir, {
    ...commonVars(runId),
    attendee_projects: attendeeProjects,
    ...(activateApis ? { activate_apis: activateApis } : {}),
  });
}

/**
 * Write terraform.tfvars.json for a challenge's per-competitor cluster layer —
 * one GKE cluster in each competitor's own project, built only when a selected
 * scenario needs one.
 *
 * `zoneLetter` is rewritten and the apply repeated when a zone turns out to be
 * out of capacity, exactly as for a workshop (`applyGkeWithZoneFailover`).
 */
export function writeChallengeClusterTfvars(
  workDir: string,
  runId: string,
  attendeeProjects: Record<string, string>,
  region: string,
  zoneLetter: string,
) {
  write(workDir, {
    ...gcpLayerVars(runId, region),
    attendee_projects: attendeeProjects,
    zone_letter: zoneLetter,
  });
}

/**
 * Write terraform.tfvars.json for a scenario layer.
 *
 * Every scenario root declares the same variables (see
 * `terraform/scenarios/README.md`), so one writer serves all of them and a
 * contributor copies `variables.tf` verbatim. `networkNames` and `nodeTags`
 * come from the cluster layer's outputs and are empty for a scenario that
 * needs no cluster.
 */
export function writeScenarioTfvars(
  workDir: string,
  runId: string,
  scenarioId: string,
  attendeeProjects: Record<string, string>,
  region: string,
  networkNames: Record<string, string>,
  nodeTags: Record<string, string>,
) {
  write(workDir, {
    ...gcpLayerVars(runId, region),
    scenario_id: scenarioId,
    attendee_projects: attendeeProjects,
    network_names: networkNames,
    node_tags: nodeTags,
  });
}

/**
 * Write terraform.tfvars.json for a challenge's per-competitor AKS clusters —
 * one apply, one cluster per competitor, built only when a scenario needs them.
 *
 * Azure keeps the roster shape GCP uses rather than AWS's per-competitor one:
 * every resource group is in the same subscription, so a single `azurerm`
 * provider reaches all of them and Terraform builds the clusters concurrently
 * inside one apply.
 */
export function writeAzureClusterTfvars(
  workDir: string,
  runId: string,
  attendeeResourceGroups: Record<string, string>,
) {
  write(workDir, {
    ...azureCommonVars(runId),
    attendee_resource_groups: attendeeResourceGroups,
  });
}

/**
 * Write terraform.tfvars.json for one competitor's EKS cluster.
 *
 * Per competitor, like everything else on AWS: the cluster is built inside that
 * competitor's own member account, which needs its own assumed-role provider.
 */
export function writeAwsClusterTfvars(
  workDir: string,
  runId: string,
  attendeeEmail: string,
  accountId: string,
  clusterName: string,
) {
  write(workDir, {
    ...awsCommonVars(runId),
    attendee_email: attendeeEmail,
    account_id: accountId,
    cluster_name: clusterName,
  });
}

/**
 * One competitor's identity, as every per-competitor scenario root takes it.
 *
 * The cloud-specific fields differ, but the shape is the same on all three: who
 * the competitor is, which environment is theirs, and how to find the cluster
 * inside it.
 */
export type CompetitorTarget = {
  email: string;
  projectId: string;
  clusterName: string;
  location: string;
  networkName: string;
  nodeTag: string;
};

/**
 * Write terraform.tfvars.json for one competitor's copy of a GCP scenario root
 * — the `perCompetitor` shape, for a scenario whose providers cannot be
 * instantiated once per competitor inside a single configuration (anything
 * reaching into the cluster with `kubernetes` or `helm`).
 *
 * Singular where the roster writer is plural: one project, one cluster, one
 * tag. A root takes one or the other, never both, which is what
 * `scenario-catalog.test.ts` checks.
 */
export function writeGcpCompetitorScenarioTfvars(
  workDir: string,
  runId: string,
  scenarioId: string,
  region: string,
  target: CompetitorTarget,
) {
  write(workDir, {
    ...gcpLayerVars(runId, region),
    scenario_id: scenarioId,
    attendee_email: target.email,
    project_id: target.projectId,
    cluster_name: target.clusterName,
    location: target.location,
    network_name: target.networkName,
    node_tag: target.nodeTag,
  });
}

/**
 * Write terraform.tfvars.json for an Azure scenario applied over the whole
 * roster — the Azure mirror of `writeScenarioTfvars`.
 */
export function writeAzureScenarioTfvars(
  workDir: string,
  runId: string,
  scenarioId: string,
  attendeeResourceGroups: Record<string, string>,
  subnetIds: Record<string, string>,
  clusterNames: Record<string, string>,
) {
  write(workDir, {
    ...azureCommonVars(runId),
    scenario_id: scenarioId,
    attendee_resource_groups: attendeeResourceGroups,
    subnet_ids: subnetIds,
    cluster_names: clusterNames,
  });
}

/**
 * Write terraform.tfvars.json for one competitor's copy of an AWS scenario
 * root.
 *
 * Every AWS scenario is `perCompetitor`, and not by choice: each competitor
 * owns a separate member account, and reaching into it means an assumed-role
 * provider that Terraform cannot create a dynamic number of. `account_id` is
 * what the copy assumes into.
 */
export function writeAwsCompetitorScenarioTfvars(
  workDir: string,
  runId: string,
  scenarioId: string,
  attendeeEmail: string,
  accountId: string,
  clusterName: string,
) {
  write(workDir, {
    ...awsCommonVars(runId),
    scenario_id: scenarioId,
    attendee_email: attendeeEmail,
    account_id: accountId,
    cluster_name: clusterName,
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
  /**
   * App registration the event's Harness Azure connector authenticates as.
   * Deterministic in (slug, runId), so provision and teardown name the same
   * one; empty — when the connector is switched off — registers none.
   */
  harnessIdentity = "",
) {
  write(workDir, {
    ...azureCommonVars(runId),
    resource_group_name: resourceGroupName,
    cluster_name: clusterName,
    service_principal_name: harnessIdentity,
    service_principal_role: azureCfg().harnessSpRole,
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
  /**
   * IAM user in the member account that the event's Harness AWS connector
   * authenticates as. Deterministic in (slug, runId), so provision and teardown
   * name the same one; empty — when the connector is switched off — creates
   * none.
   */
  harnessIdentity = "",
) {
  write(workDir, {
    ...awsCommonVars(runId),
    account_name: accountName,
    account_email: accountEmail,
    cluster_name: clusterName,
    attendee_emails: attendeeEmails,
    harness_user_name: harnessIdentity,
    harness_user_policy_arn: awsCfg().harnessUserPolicyArn,
  });
}

/**
 * Write terraform.tfvars.json for one competitor's AWS account in a challenge.
 * The runner calls this once per competitor and applies the single-account root
 * with a per-competitor state prefix — Terraform can't create a dynamic number
 * of cross-account providers in one apply.
 */
export function writeAwsChallengeTfvars(
  workDir: string,
  runId: string,
  accountName: string,
  accountEmail: string,
  attendeeEmail: string,
) {
  write(workDir, {
    ...awsCommonVars(runId),
    account_name: accountName,
    account_email: accountEmail,
    attendee_email: attendeeEmail,
  });
}
