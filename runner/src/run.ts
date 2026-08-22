import path from "node:path";
import {
  assertCloudsConfigured,
  awsAccountEmail,
  awsCfg,
  azureCfg,
  cloudStatePrefix,
  gcpCfg,
  harnessCfg,
  stateBucket,
  TF_ROOT,
  challengeProjectMap,
  challengeResourceGroupMap,
  makeAwsAccountName,
  makeChallengeAwsAccountName,
  makeClusterName,
  makeProjectId,
  makeResourceGroupName,
  regionFromLocation,
  PROVISION_LEAD_HOURS,
} from "./config.js";
import {
  writeAwsChallengeTfvars,
  writeAwsTfvars,
  writeAzureChallengeTfvars,
  writeAzureTfvars,
  writeChallengeTfvars,
  writeDelegateTfvars,
  writeTfvars,
} from "./workspace.js";
import { tfApply, tfInit, tfOutput } from "./terraform.js";
import { issueAccessPass, tapPolicy } from "./graph.js";
import { allocateEmails, createAccount, createOrgUnit } from "./directory.js";
import { recordOutputResources } from "./resources.js";
import { summarize } from "./retry.js";
import { displayName } from "./usernames.js";
import {
  createAttendeeRole,
  createOrg,
  createProject,
  ensureOrgDelegateToken,
  grantAccountAdmin,
  grantOrgAttendee,
  grantProjectAdmin,
  orgIdentifier,
  orgUrl,
  projectIdentifier,
  projectUrl,
} from "./harness.js";
import {
  accountsFor,
  accountsWithPasswordsFor,
  addAccount,
  getRun,
  log,
  recordResource,
  runCreatorEmail,
  setApplying,
  setFailed,
  setLiveError,
  setOrgUnitPath,
  setAzureAccessPass,
  setProvisioning,
  setReady,
  type Cloud,
  type RunRow,
} from "./db.js";

/** Root config that creates the workshop's single shared GCP project. */
const GCP_TF_SOURCE = "workshops/gcp-base";

/** Root config that creates one GCP project per challenge competitor. */
const GCP_CHALLENGE_TF_SOURCE = "challenges/gcp-per-user";

/** Grant-only config: attendees get access to the shared long-lived project. */
const GCP_SANDBOX_TF_SOURCE = "workshops/gcp-sandbox";

/** Root config that creates the workshop's shared Azure resource group. */
const AZURE_TF_SOURCE = "workshops/azure-base";

/** Root config that creates one Azure resource group per challenge competitor. */
const AZURE_CHALLENGE_TF_SOURCE = "challenges/azure-per-user";

/** Root config that creates the workshop's single AWS member account. */
const AWS_TF_SOURCE = "workshops/aws-base";

/** Single-account root the runner applies once per AWS challenge competitor. */
const AWS_CHALLENGE_TF_SOURCE = "challenges/aws-per-user";

/** Delegate roots — install an org delegate into a cluster of the given cloud. */
const DELEGATE_GKE_TF_SOURCE = "delegates/gke";
const DELEGATE_AKS_TF_SOURCE = "delegates/aks";
const DELEGATE_EKS_TF_SOURCE = "delegates/eks";

/** Provision one workshop end to end: Workspace OU, accounts, then clouds. */
export async function runWorkshop(runId: string): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error(`run ${runId} not found`);

  try {
    await setProvisioning(runId);

    // Before anything is created: a cloud this deployment has no credentials
    // for fails here, not two minutes in with a roster already built.
    assertCloudsConfigured(run.clouds);

    const orgUnitPath = await provisionAccounts(run);
    const outputs: Record<string, unknown> = {
      org_unit_path: orgUnitPath,
      user_count: run.user_count,
    };

    // Fold one apply's outputs into the run's, and record what it built while
    // the build is still going — `outputs` itself is only stored when the run
    // goes ready, which is far too late to be watched.
    const merge = async (partial: Record<string, unknown>) => {
      Object.assign(outputs, partial);
      await recordOutputResources(run.id, partial);
    };

    // Harness is provisioned for every workshop, not gated on a cloud, and
    // after the accounts exist because each attendee is invited by address.
    Object.assign(outputs, await provisionHarness(run));

    if (run.clouds.length === 0) {
      // No cloud selected — hand attendees the shared long-lived testing
      // project instead of building (and later destroying) a throwaway one.
      await merge(await provisionSandbox(run));
    } else {
      for (const cloud of run.clouds) {
        if (cloud === "gcp") {
          await merge(
            run.mode === "challenge"
              ? await provisionGcpPerUser(run)
              : await provisionGcp(run),
          );
        } else if (cloud === "azure") {
          await merge(
            run.mode === "challenge"
              ? await provisionAzurePerUser(run)
              : await provisionAzure(run),
          );
        } else if (cloud === "aws") {
          await merge(
            run.mode === "challenge"
              ? await provisionAwsPerUser(run)
              : await provisionAws(run),
          );
        }
      }
    }

    // Put an org-scoped Harness delegate in each cluster that was built. This
    // is best-effort and never throws — a delegate that will not install must
    // not fail an otherwise-good workshop (see installDelegates).
    await installDelegates(run, outputs);

    // Keep the original expiry when re-provisioning a workshop that grew —
    // editing its config must not silently extend how long it lives.
    const expiresAt =
      run.expires_at ?? new Date(Date.now() + run.ttl_seconds * 1000);
    await setReady(runId, outputs, expiresAt);
    await log(runId, "system", `Ready. Auto-destroys at ${expiresAt.toISOString()}`);
  } catch (err) {
    // `summarize` keeps a transient-provider blob (e.g. a Google HTML "Error
    // 502" page) from being stored as the whole error — a short, attributed
    // one-liner lands in the log and the `error` column instead.
    const message = summarize(err);
    await log(runId, "stderr", message);
    if (run.expires_at) {
      // This workshop was already live — a grow or a retry (a first provision
      // has no expiry until it goes ready). A failure here must not tear down
      // the accounts and clouds it already has, so leave it ready with its
      // original expiry and just surface what went wrong. The change did not
      // apply; what was there stays.
      await setLiveError(runId, message);
    } else {
      // First provision: record the failure but do not expire it. Nothing here
      // destroys resources on a failure — the run stays failed on the calendar
      // until someone deletes it in the UI, which is what cleans up any partial
      // resources it left behind.
      await setFailed(runId, message);
    }
    throw err;
  }
}

/**
 * Install an organization-level Harness delegate into every cluster the run
 * just built.
 *
 * Deliberately best-effort: this never throws, so a delegate that will not
 * install — a Harness-side blip, a new cluster still stabilising, missing
 * egress — is logged and the workshop still goes ready. One org-scoped token
 * (its scope is what makes the delegates org-level) is shared by every cluster
 * in the event; each cloud installs independently, so one failing does not stop
 * the rest. Only a workshop reaches here with clusters — a challenge builds bare
 * per-competitor environments with none.
 *
 * Teardown is implicit: the reaper's cluster destroy takes the delegate with
 * it, so there is no separate delegate teardown to run.
 */
async function installDelegates(
  run: RunRow,
  outputs: Record<string, unknown>,
): Promise<void> {
  const cfg = harnessCfg();
  if (!cfg.delegatesEnabled || run.mode !== "workshop") return;

  const str = (k: string): string | undefined =>
    typeof outputs[k] === "string" ? (outputs[k] as string) : undefined;

  type Target = { cloud: Cloud; source: string; vars: Record<string, unknown> };
  const targets: Target[] = [];

  // GKE — a GCP workshop (gcp_project_id) or the no-cloud sandbox cluster
  // (sandbox_project_id / the configured shared project).
  const gkeName = str("gke_cluster_name");
  const gkeLoc = str("gke_cluster_location");
  const gkeProject =
    str("gcp_project_id") ?? str("sandbox_project_id") ?? gcpCfg().sandboxProjectId;
  if (gkeName && gkeLoc && gkeProject) {
    targets.push({
      cloud: "gcp",
      source: DELEGATE_GKE_TF_SOURCE,
      vars: {
        // From the cluster's own location, not the configured region: the
        // delegate has to reach the cluster that exists, which for a run built
        // before the default region moved is not in the configured one.
        region: regionFromLocation(gkeLoc) ?? gcpCfg().region,
        project_id: gkeProject,
        cluster_name: gkeName,
        location: gkeLoc,
      },
    });
  }

  // AKS.
  const aksName = str("aks_cluster_name");
  const resourceGroup = str("azure_resource_group");
  if (aksName && resourceGroup) {
    targets.push({
      cloud: "azure",
      source: DELEGATE_AKS_TF_SOURCE,
      vars: {
        subscription_id: azureCfg().subscriptionId,
        resource_group_name: resourceGroup,
        cluster_name: aksName,
      },
    });
  }

  // EKS.
  const eksName = str("eks_cluster_name");
  const awsAccountId = str("aws_account_id");
  if (eksName && awsAccountId) {
    targets.push({
      cloud: "aws",
      source: DELEGATE_EKS_TF_SOURCE,
      vars: {
        region: awsCfg().region,
        aws_account_id: awsAccountId,
        account_access_role: awsCfg().accountAccessRole,
        cluster_name: eksName,
      },
    });
  }

  if (targets.length === 0) return;

  const orgId = orgIdentifier(run.name, run.id);
  let token: string;
  try {
    token = await ensureOrgDelegateToken(orgId);
  } catch (err) {
    await log(
      run.id,
      "stderr",
      `Skipping Harness delegates — could not get an org delegate token: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return;
  }

  const common = {
    account_id: cfg.accountId,
    delegate_token: token,
    manager_endpoint: cfg.baseUrl,
    delegate_image: cfg.delegateImage,
  };
  const clusterName = makeClusterName(run.slug, run.id);

  for (const target of targets) {
    const delegateName = delegateNameFor(clusterName, target.cloud);
    try {
      await log(
        run.id,
        "system",
        `Installing org Harness delegate "${delegateName}" into the ` +
          `${target.cloud.toUpperCase()} cluster ${target.vars.cluster_name}`,
      );
      const workDir = path.join(TF_ROOT, target.source);
      writeDelegateTfvars(workDir, {
        ...target.vars,
        ...common,
        delegate_name: delegateName,
      });
      await tfInit(
        workDir,
        stateBucket(),
        `${run.state_prefix}/delegate/${target.cloud}`,
        (l) => log(run.id, l.stream, l.text),
      );
      await tfApply(workDir, (l) => log(run.id, l.stream, l.text));
      await log(run.id, "stdout", `delegate ${delegateName} installed`);
      // Keyed by cloud: a multi-cloud workshop installs one per cluster, and
      // each is its own thing to see.
      await recordResource(run.id, {
        kind: "harness_delegate",
        key: target.cloud,
        label: `Harness delegate (${target.cloud.toUpperCase()})`,
        detail: delegateName,
      });
    } catch (err) {
      // Best-effort: log and keep going. The workshop is otherwise ready, and
      // the run can be retried to attempt the delegate again.
      await log(
        run.id,
        "stderr",
        `Harness delegate for the ${target.cloud.toUpperCase()} cluster did ` +
          `not install (${summarize(err)}). The workshop is otherwise ready.`,
      );
    }
  }
}

/**
 * A delegate/Helm-release name for a cluster: DNS-1123, and suffixed with the
 * cloud so a multi-cloud event's clusters (which share a base cluster name)
 * don't collide within the one org.
 */
function delegateNameFor(clusterName: string, cloud: Cloud): string {
  return `${clusterName}-${cloud}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
}

/** Create the workshop's org unit and its attendee accounts. */
async function provisionAccounts(run: RunRow): Promise<string> {
  // Surface Directory API retry notices in the run's live log, so a room sees
  // "Google … retrying" rather than a silent stall on a transient Google blip.
  const notify = (message: string) => log(run.id, "system", message);

  await log(run.id, "system", `Creating organizational unit "${run.name}"`);
  const orgUnitPath = await createOrgUnit(run.name, notify);
  await setOrgUnitPath(run.id, orgUnitPath);
  await log(run.id, "system", `Org unit ready at ${orgUnitPath}`);
  await recordResource(run.id, {
    kind: "org_unit",
    label: "Google Workspace org unit",
    detail: orgUnitPath,
  });

  // Accounts already handed out must keep their credentials, so only the
  // missing ones are created. This is what makes growing a workshop safe.
  const existing = new Set((await accountsFor(run.id)).map((a) => a.email));
  const todo = run.user_count - existing.size;

  // The roster as one counted item, updated after every account rather than at
  // the end: creating fifty accounts takes minutes, and a count that only
  // appears once they are all done is a count nobody can watch. The addresses
  // themselves are deliberately not recorded here — they are on the run page
  // already, behind their credentials.
  const countAccounts = (done: number) =>
    recordResource(run.id, {
      kind: "accounts",
      label: "Attendee accounts",
      done,
      total: run.user_count,
    });

  if (todo <= 0) {
    await log(run.id, "system", `${existing.size} attendee account(s) already exist`);
    await countAccounts(existing.size);
    return orgUnitPath;
  }
  await log(
    run.id,
    "system",
    existing.size > 0
      ? `Adding ${todo} attendee account(s) to the existing ${existing.size}`
      : `Creating ${todo} attendee account(s)`,
  );

  // Names are random, so they are reserved up front against the directory
  // rather than derived from the index. `existing` is passed in so a workshop
  // that grew cannot be handed a name it already owns.
  const emails = await allocateEmails(todo, existing);

  let created = existing.size;
  await countAccounts(created);
  for (const email of emails) {
    const account = await createAccount({ email, orgUnitPath }, notify);
    await addAccount(run.id, account.email, account.tempPassword);
    await log(run.id, "stdout", `created ${account.email}`);
    await countAccounts(++created);
  }

  return orgUnitPath;
}

/**
 * Create the workshop's Harness organization and one project per attendee.
 *
 * Each attendee administers their own project and gets view/use access across
 * the org, so they can see everyone else's work without being able to change
 * it. Every call is idempotent, so a grown or retried workshop only adds what
 * is missing.
 */
async function provisionHarness(run: RunRow): Promise<Record<string, unknown>> {
  const orgId = orgIdentifier(run.name, run.id);

  await log(run.id, "system", `Creating Harness organization ${orgId}`);
  const existed = await createOrg(orgId, run.name);
  if (existed) {
    await log(run.id, "stdout", `organization ${orgId} already existed — reusing`);
  }
  await recordResource(run.id, {
    kind: "harness_org",
    label: "Harness organization",
    detail: orgId,
    url: orgUrl(orgId),
  });

  // The org-scope binding every attendee gets references this role, so it has
  // to exist before anyone is bound to it.
  await createAttendeeRole(orgId);

  // Grant the run's creator account admin — the instructor role the reference
  // gives an event's owner. A creator without a recorded email is skipped
  // rather than failing the run.
  const creator = await runCreatorEmail(run.id);
  if (creator) {
    await grantAccountAdmin(creator);
    await log(run.id, "stdout", `${creator} -> account admin (instructor)`);
  } else {
    await log(run.id, "system", "no creator email on file — skipping account admin");
  }

  const accounts = await accountsFor(run.id);
  await log(
    run.id,
    "system",
    `Creating ${accounts.length} Harness project(s), one per attendee`,
  );

  // Counted in place as they land, for the same reason the accounts are: one
  // project per attendee is one row per attendee, which is the pile-up.
  const countProjects = (done: number) =>
    recordResource(run.id, {
      kind: "harness_projects",
      label: "Harness projects",
      detail: "one per attendee",
      done,
      total: accounts.length,
    });

  // Keyed by address, the same shape the per-competitor cloud outputs use, so
  // the attendee page can hand each row its own project link. The identifier
  // is derived rather than stored, but deriving it a second time in the
  // frontend would be a second copy of `harnessIdentifier`'s rules to keep in
  // step — emitting the finished URL keeps those rules in one place.
  const projectUrls: Record<string, string> = {};

  let built = 0;
  await countProjects(built);
  for (const { email } of accounts) {
    const projectId = projectIdentifier(email);
    const { givenName, familyName } = displayName(email.split("@")[0] ?? email);

    await createProject(orgId, projectId, `${givenName} ${familyName}`);
    await grantProjectAdmin(orgId, projectId, email);
    await grantOrgAttendee(orgId, email);
    projectUrls[email] = projectUrl(orgId, projectId);

    await log(run.id, "stdout", `${email} -> admin of project ${projectId}`);
    await countProjects(++built);
  }

  return {
    harness_org: orgId,
    harness_org_url: orgUrl(orgId),
    harness_project_urls: projectUrls,
  };
}

/**
 * Substrings that mark a GKE apply failure as "this zone can't give us the
 * cluster right now" rather than a real config error, so the runner should try
 * another zone rather than give up. Two shapes:
 *   - an explicit GCE stockout (the zone immediately reports no room), and
 *   - a create that ran past `create_timeout` (a capacity-starved zone where
 *     GKE keeps retrying the initial node internally instead of erroring —
 *     Terraform surfaces this as a "timeout while waiting for state" / context
 *     deadline). Bounding the timeout in the module is what turns that silent
 *     hang into a prompt, catchable failure.
 */
const GKE_CAPACITY_SIGNATURES = [
  "does not have enough resources available",
  "zone_resource_pool_exhausted",
  "resource pool exhausted",
  "try a different location",
  "timeout while waiting for state to become",
  "context deadline exceeded",
];

function isGkeCapacityError(text: string): boolean {
  const t = text.toLowerCase();
  return GKE_CAPACITY_SIGNATURES.some((s) => t.includes(s));
}

/**
 * Signatures AWS Organizations returns when the organization is already busy
 * with another account operation.
 *
 * The management account is shared by every AWS run, and Organizations
 * processes account creation one at a time across the whole org — so two
 * workshops starting together contend on it even though their state, their
 * accounts, and everything else about them are separate. The AWS provider
 * retries only `FinalizingOrganizationException` itself; a
 * `ConcurrentModificationException` is modelled as a client fault and is not
 * retried by the SDK either, so without this the second workshop of a pair
 * just fails.
 */
const AWS_ORG_CONTENTION_SIGNATURES = [
  "concurrentmodificationexception",
  "finalizingorganizationexception",
  "toomanyrequestsexception",
  "throttlingexception",
];

/**
 * Signatures a member account returns while it is still being switched on.
 *
 * Organizations reports an account ACTIVE the moment CreateAccount finishes,
 * but only IAM is usable that early: for the first few minutes every EC2 call
 * comes back `OptInRequired` ("You are not subscribed to this service"). The
 * apply that creates the account goes straight on to build the cluster inside
 * it, so it walks into exactly that window — the attendee users and the
 * cluster's IAM roles land, and everything touching EC2 fails. Waiting and
 * re-applying resumes there.
 */
const AWS_ACCOUNT_WARMUP_SIGNATURES = [
  "optinrequired",
  "not subscribed to this service",
];

/** Why an AWS apply is worth another attempt rather than being a real failure. */
type AwsRetryKind = "contention" | "warmup";

function awsRetryKind(text: string): AwsRetryKind | null {
  const t = text.toLowerCase();
  if (AWS_ORG_CONTENTION_SIGNATURES.some((sig) => t.includes(sig))) {
    return "contention";
  }
  if (AWS_ACCOUNT_WARMUP_SIGNATURES.some((sig) => t.includes(sig))) {
    return "warmup";
  }
  return null;
}

/**
 * Waits between attempts, counted per reason so a run that hits both still gets
 * a full budget for each. Both are minutes rather than seconds: one waits on
 * another account creation finishing, the other on AWS finishing this one.
 */
const AWS_RETRY_DELAYS_MS: Record<AwsRetryKind, number[]> = {
  contention: [60_000, 120_000, 240_000],
  warmup: [60_000, 120_000, 180_000, 300_000],
};

const AWS_RETRY_REASONS: Record<AwsRetryKind, string> = {
  contention:
    "AWS Organizations is busy with another workshop's account (only one " +
    "account is created at a time across the organization)",
  warmup:
    "the new AWS account is still activating (a brand-new account answers " +
    "OptInRequired on EC2 for its first few minutes)",
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Apply an AWS root, retrying the failures that are only a matter of timing:
 * another run holding the organization, or this run's own account not being
 * switched on yet.
 *
 * Retrying the whole apply is safe and cheap here: Terraform is convergent and
 * the state already records whatever the failed attempt built, so a retry
 * re-plans (seconds) and resumes where it stopped rather than starting over.
 *
 * Anything else is a real failure and is rethrown on the spot.
 */
async function applyAwsWithRetry(run: RunRow, workDir: string): Promise<void> {
  const attempts: Record<AwsRetryKind, number> = { contention: 0, warmup: 0 };

  for (;;) {
    let captured = "";
    try {
      await tfApply(workDir, (l) => {
        if (l.stream === "stderr") captured += l.text + "\n";
        return log(run.id, l.stream, l.text);
      });
      return;
    } catch (err) {
      const kind = awsRetryKind(captured);
      if (!kind) throw err;

      const delay = AWS_RETRY_DELAYS_MS[kind][attempts[kind]++];
      if (delay === undefined) throw err;

      await log(
        run.id,
        "system",
        `AWS apply stopped because ${AWS_RETRY_REASONS[kind]}; ` +
          `retrying in ${delay / 1000}s.`,
      );
      await wait(delay);
    }
  }
}

/** Zone letter from a location like "us-west1-c" (region "us-west1"). */
function zoneLetterFromLocation(
  location: unknown,
  region: string,
): string | undefined {
  const prefix = `${region}-`;
  return typeof location === "string" && location.startsWith(prefix)
    ? location.slice(prefix.length)
    : undefined;
}

/**
 * The region a run's GCP resources belong in: the one they are already in if
 * the run has been built, and only otherwise the configured one.
 *
 * A built run is pinned because the region is not a free variable once
 * anything exists — the VPC subnet and the GKE cluster are both regional
 * placements, and Terraform's answer to a changed placement is to destroy and
 * recreate. Re-applying a live workshop after the default region moved would
 * therefore delete the cluster the room is working in, which is not something
 * a config change should be able to do. New runs get the configured region;
 * everything already standing stays where it was built, for the rest of its
 * short life.
 *
 * Read from the recorded cluster location, which is the one output that
 * carries a placement. Runs with no cluster (challenges, whose per-competitor
 * projects have no regional resources at all) have nothing to pin and nothing
 * that moving the region would disturb.
 */
function gcpRegionFor(run: RunRow): string {
  return (
    regionFromLocation(run.outputs?.gke_cluster_location) ?? gcpCfg().region
  );
}

/**
 * Apply a GKE-building workshop root, walking `gcpCfg().gkeZones` when a zone
 * is out of GCE capacity so a busy default zone doesn't fail the whole
 * workshop. A zonal GKE cluster lives in exactly one zone and GCE stockouts are
 * almost always zone-specific, so the next zone usually has room; the regional
 * VPC/subnet the root also builds is zone-independent, so switching zones only
 * re-places the (not-yet-created) cluster with no rework.
 *
 * `writeVarsForZone(zone)` rewrites the root's tfvars for the given zone letter
 * — apply re-reads the file each time, so the new zone takes effect. Only
 * capacity failures trigger a retry; any other apply error is a real failure
 * and rethrown unchanged.
 *
 * A workshop that is only *growing* already has its cluster in some zone;
 * moving it would tear the live cluster down and rebuild it, so when the run
 * already recorded a cluster location we pin to that zone and skip the walk.
 * The walk is over the zones of the run's own region (`gcpRegionFor`), which
 * for a built run is where it stands rather than where new runs go.
 */
async function applyGkeWithZoneFailover(
  run: RunRow,
  workDir: string,
  writeVarsForZone: (zone: string) => void,
): Promise<void> {
  const cfg = gcpCfg();
  const region = gcpRegionFor(run);
  const pinned = zoneLetterFromLocation(
    run.outputs?.gke_cluster_location,
    region,
  );
  const zones = pinned ? [pinned] : cfg.gkeZones;

  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i];
    const last = i === zones.length - 1;
    writeVarsForZone(zone);

    let captured = "";
    try {
      await tfApply(workDir, (l) => {
        if (l.stream === "stderr") captured += l.text + "\n";
        return log(run.id, l.stream, l.text);
      });
      if (i > 0) {
        await log(
          run.id,
          "system",
          `GKE cluster created in ${region}-${zone}.`,
        );
      }
      return;
    } catch (err) {
      if (last || !isGkeCapacityError(captured)) throw err;
      await log(
        run.id,
        "system",
        `Zone ${region}-${zone} is out of capacity for the GKE cluster; ` +
          `retrying in ${region}-${zones[i + 1]}.`,
      );
    }
  }
}

/** Terraform the workshop's GCP project. */
async function provisionGcp(run: RunRow): Promise<Record<string, unknown>> {
  const cfg = gcpCfg();
  const workDir = path.join(TF_ROOT, GCP_TF_SOURCE);
  const projectId = run.gcp_project_id ?? makeProjectId(run.slug, run.id);
  const clusterName = makeClusterName(run.slug, run.id);

  await setApplying(run.id, projectId);
  await log(run.id, "system", `Provisioning GCP project ${projectId}`);

  // Read the accounts back rather than tracking which were just created, so a
  // workshop that grew re-grants the whole roster and Terraform converges.
  const attendees = (await accountsFor(run.id)).map((a) => a.email);

  await log(run.id, "system", "terraform init");
  await tfInit(workDir, cfg.stateBucket, run.state_prefix, (l) =>
    log(run.id, l.stream, l.text),
  );

  await log(
    run.id,
    "system",
    `terraform apply — creating project, billing, APIs, the GKE cluster ` +
      `${clusterName}, and granting editor to ${attendees.length} attendee(s)`,
  );
  await applyGkeWithZoneFailover(run, workDir, (zone) =>
    writeTfvars(workDir, projectId, run.id, attendees, {
      clusterName,
      zoneLetter: zone,
      region: gcpRegionFor(run),
    }),
  );

  return tfOutput(workDir);
}

/**
 * Grant the run's attendees editor on the shared long-lived project. Used when
 * a run has no cloud selected — a fast path for testing that skips creating and
 * later destroying a per-run project. The Terraform here only manages the
 * attendees' IAM bindings; it never touches the project, so teardown just
 * revokes the grants (see `destroySandbox`).
 */
async function provisionSandbox(run: RunRow): Promise<Record<string, unknown>> {
  const cfg = gcpCfg();
  if (!cfg.sandboxProjectId) {
    throw new Error(
      "no cloud was selected, which grants attendees the shared testing " +
        "project, but GCP_SANDBOX_PROJECT_ID is not configured",
    );
  }
  const workDir = path.join(TF_ROOT, GCP_SANDBOX_TF_SOURCE);
  const clusterName = makeClusterName(run.slug, run.id);

  // No project id is stored on the run: the shared project is not this run's to
  // own, and keeping it out of `gcp_project_id` ensures no teardown path could
  // ever mistake it for a per-run project to delete.
  await setApplying(run.id, null);
  await log(
    run.id,
    "system",
    `No cloud selected — granting attendees access to the shared testing project ${cfg.sandboxProjectId} and building the GKE cluster ${clusterName} in it`,
  );

  // Read the accounts back rather than tracking which were just created, so a
  // workshop that grew re-grants the whole roster and Terraform converges.
  const attendees = (await accountsFor(run.id)).map((a) => a.email);

  await log(run.id, "system", "terraform init");
  await tfInit(workDir, cfg.stateBucket, run.state_prefix, (l) =>
    log(run.id, l.stream, l.text),
  );

  await log(
    run.id,
    "system",
    `terraform apply — granting editor to ${attendees.length} attendee(s) and ` +
      `building the GKE cluster ${clusterName} on ${cfg.sandboxProjectId}`,
  );
  await applyGkeWithZoneFailover(run, workDir, (zone) =>
    writeTfvars(workDir, cfg.sandboxProjectId, run.id, attendees, {
      clusterName,
      zoneLetter: zone,
      region: gcpRegionFor(run),
    }),
  );

  return tfOutput(workDir);
}

/**
 * Terraform a challenge's GCP environment: one project per competitor, each
 * owned (administered) by the competitor it belongs to.
 *
 * `gcp_project_id` on the run stays null here — there is no single project to
 * put in it. The full address -> project id mapping lands in the run's
 * outputs, and the ids are recomputed rather than stored because
 * `makeChallengeProjectId` is deterministic in the address.
 */
async function provisionGcpPerUser(
  run: RunRow,
): Promise<Record<string, unknown>> {
  const cfg = gcpCfg();
  const workDir = path.join(TF_ROOT, GCP_CHALLENGE_TF_SOURCE);

  await setApplying(run.id, null);

  // Read the accounts back rather than tracking which were just created, so a
  // challenge that grew re-declares the whole roster and Terraform converges.
  const projects = challengeProjectMap(
    run.slug,
    run.id,
    (await accountsFor(run.id)).map((a) => a.email),
  );
  const count = Object.keys(projects).length;

  await log(
    run.id,
    "system",
    `Provisioning ${count} GCP project(s), one per competitor`,
  );

  writeChallengeTfvars(workDir, run.id, projects);

  await log(run.id, "system", "terraform init");
  await tfInit(workDir, cfg.stateBucket, run.state_prefix, (l) =>
    log(run.id, l.stream, l.text),
  );

  await log(
    run.id,
    "system",
    `terraform apply — creating ${count} project(s), billing, and APIs, ` +
      `granting each competitor owner on their own`,
  );
  await tfApply(workDir, (l) => log(run.id, l.stream, l.text));

  return tfOutput(workDir);
}

/** Address -> temp-password map the Azure roots turn into native Entra users. */
async function attendeePasswords(
  runId: string,
): Promise<Record<string, string>> {
  const accounts = await accountsWithPasswordsFor(runId);
  return Object.fromEntries(accounts.map((a) => [a.email, a.tempPassword]));
}

/**
 * Give every attendee a Temporary Access Pass for the Entra account Terraform
 * just created.
 *
 * The password alone no longer gets anyone into the Azure portal: Microsoft
 * enforces MFA there tenant-wide, above Conditional Access and independent of
 * security defaults. A pass satisfies that with nothing to install and nothing
 * to enrol, which is the only shape of answer a two-hour workshop can use.
 *
 * Best-effort, like the delegate install, and for the same reason: an attendee
 * whose pass failed still has a working account, a password, and every other
 * cloud in the workshop, and none of that should be thrown away over the one
 * credential. What it must not do is fail quietly — a run whose passes did not
 * issue is a room that cannot sign into Azure, so every failure is logged with
 * the address it belongs to, and the tally goes in the run log where the
 * organizer will see it before the event rather than during.
 *
 * The lifetime is the workshop's own, plus the provisioning lead — a pass that
 * expired before the room opened would be worse than none — and is then clamped
 * to whatever bounds the tenant's policy sets, since a request outside them is
 * simply rejected.
 */
async function issueAzureAccessPasses(
  run: RunRow,
  emails: string[],
): Promise<void> {
  const cfg = azureCfg();
  if (!cfg.tapEnabled || emails.length === 0) return;

  let policy;
  try {
    policy = await tapPolicy();
  } catch (err) {
    await log(
      run.id,
      "stderr",
      `Could not read the Temporary Access Pass policy, so no passes were ` +
        `issued — attendees have a password, which Azure's mandatory MFA will ` +
        `not accept on its own. The runner's app registration needs the Graph ` +
        `permission UserAuthenticationMethod.ReadWrite.All (admin-consented). ` +
        `${summarize(err)}`,
    );
    return;
  }

  if (!policy || policy.state !== "enabled") {
    await log(
      run.id,
      "stderr",
      `Temporary Access Pass is not enabled in this tenant, so no passes were ` +
        `issued. Turn it on under Entra admin center -> Protection -> ` +
        `Authentication methods -> Temporary Access Pass, or set ` +
        `AZURE_TAP_ENABLED=false if this tenant does not enforce MFA on ` +
        `portal sign-ins.`,
    );
    return;
  }

  // The workshop's life, plus the lead time it was built ahead of the start,
  // held inside the tenant's bounds.
  const wanted =
    Math.ceil(run.ttl_seconds / 60) + Math.ceil(PROVISION_LEAD_HOURS * 60);
  const lifetimeInMinutes = Math.min(
    policy.maximumLifetimeInMinutes,
    Math.max(policy.minimumLifetimeInMinutes, wanted),
  );
  // A tenant that mandates single-use passes wins over the runner's preference.
  const oneTime = cfg.tapOneTime || policy.isUsableOnce;

  await log(
    run.id,
    "system",
    `Issuing ${emails.length} Temporary Access Pass(es), ${lifetimeInMinutes} ` +
      `minutes, ${oneTime ? "single-use" : "reusable"} — this is what attendees ` +
      `sign into the Azure portal with`,
  );

  let issued = 0;
  const failed: string[] = [];
  for (const email of emails) {
    try {
      const pass = await issueAccessPass(email, { lifetimeInMinutes, oneTime });
      await setAzureAccessPass(run.id, email, pass.code, pass.expiresAt);
      issued++;
    } catch (err) {
      failed.push(email);
      await log(run.id, "stderr", `access pass for ${email}: ${summarize(err)}`);
    }
  }

  if (failed.length > 0) {
    await log(
      run.id,
      "stderr",
      `${issued}/${emails.length} access passes issued. Without one, these ` +
        `attendees cannot sign into the Azure portal: ${failed.join(", ")}`,
    );
  }

  if (lifetimeInMinutes < wanted) {
    await log(
      run.id,
      "system",
      `The tenant caps passes at ${policy.maximumLifetimeInMinutes} minutes, ` +
        `which is shorter than this workshop — they will need reissuing before ` +
        `it ends. Raise the cap under Entra admin center -> Protection -> ` +
        `Authentication methods -> Temporary Access Pass.`,
    );
  }
}

/**
 * Terraform the workshop's Azure environment: one shared resource group, a
 * native Entra user per attendee (same credential as their Google account),
 * Contributor for each, and a small AKS cluster. The Azure mirror of
 * `provisionGcp`; its state is namespaced under the run's prefix so it never
 * collides with the run's GCP state.
 */
async function provisionAzure(run: RunRow): Promise<Record<string, unknown>> {
  const workDir = path.join(TF_ROOT, AZURE_TF_SOURCE);
  const resourceGroup = makeResourceGroupName(run.slug, run.id);
  const clusterName = makeClusterName(run.slug, run.id);

  await log(run.id, "system", `Provisioning Azure resource group ${resourceGroup}`);

  const attendees = await attendeePasswords(run.id);
  writeAzureTfvars(workDir, run.id, resourceGroup, clusterName, attendees);

  await log(run.id, "system", "terraform init");
  await tfInit(
    workDir,
    stateBucket(),
    cloudStatePrefix(run.state_prefix, "azure"),
    (l) => log(run.id, l.stream, l.text),
  );

  await log(
    run.id,
    "system",
    `terraform apply — creating resource group, ${Object.keys(attendees).length} ` +
      `Entra user(s), the AKS cluster ${clusterName}, and Contributor grants`,
  );
  await tfApply(workDir, (l) => log(run.id, l.stream, l.text));

  // After the apply, because a pass is issued against a user that has to exist.
  await issueAzureAccessPasses(run, Object.keys(attendees));

  return tfOutput(workDir);
}

/**
 * Terraform a challenge's Azure environment: one resource group per competitor,
 * each owned by the competitor, with no cluster (they build it). The Azure
 * mirror of `provisionGcpPerUser`; the RG names are recomputed deterministically
 * from the address, so nothing extra is stored to tear them down.
 */
async function provisionAzurePerUser(
  run: RunRow,
): Promise<Record<string, unknown>> {
  const workDir = path.join(TF_ROOT, AZURE_CHALLENGE_TF_SOURCE);

  const attendees = await attendeePasswords(run.id);
  const groups = challengeResourceGroupMap(
    run.slug,
    run.id,
    Object.keys(attendees),
  );
  const count = Object.keys(groups).length;

  await log(
    run.id,
    "system",
    `Provisioning ${count} Azure resource group(s), one per competitor`,
  );
  writeAzureChallengeTfvars(workDir, run.id, groups, attendees);

  await log(run.id, "system", "terraform init");
  await tfInit(
    workDir,
    stateBucket(),
    cloudStatePrefix(run.state_prefix, "azure"),
    (l) => log(run.id, l.stream, l.text),
  );

  await log(
    run.id,
    "system",
    `terraform apply — creating ${count} resource group(s) and Entra user(s), ` +
      `granting each competitor Owner on their own`,
  );
  await tfApply(workDir, (l) => log(run.id, l.stream, l.text));

  // After the apply, because a pass is issued against a user that has to exist.
  await issueAzureAccessPasses(run, Object.keys(attendees));

  return tfOutput(workDir);
}

/**
 * Terraform the workshop's AWS environment: one new member account (the
 * isolation boundary), an IAM user per attendee with PowerUserAccess, and a
 * small EKS cluster. The AWS mirror of `provisionGcp`. Passwords are
 * AWS-generated and come back in the outputs (`aws_attendee_passwords`) — AWS
 * is the one cloud whose password is not the shared Google one.
 */
async function provisionAws(run: RunRow): Promise<Record<string, unknown>> {
  const cfg = awsCfg();
  const workDir = path.join(TF_ROOT, AWS_TF_SOURCE);
  const accountName = makeAwsAccountName(run.slug, run.id);
  const accountEmail = awsAccountEmail(accountName, cfg.accountEmailDomain);
  const clusterName = makeClusterName(run.slug, run.id);

  await log(run.id, "system", `Provisioning AWS account ${accountName}`);

  const attendees = (await accountsFor(run.id)).map((a) => a.email);
  writeAwsTfvars(
    workDir,
    run.id,
    accountName,
    accountEmail,
    clusterName,
    attendees,
  );

  await log(run.id, "system", "terraform init");
  await tfInit(
    workDir,
    stateBucket(),
    cloudStatePrefix(run.state_prefix, "aws"),
    (l) => log(run.id, l.stream, l.text),
  );

  await log(
    run.id,
    "system",
    `terraform apply — creating account, ${attendees.length} IAM user(s), the ` +
      `EKS cluster ${clusterName}, and PowerUser grants`,
  );
  await applyAwsWithRetry(run, workDir);

  return tfOutput(workDir);
}

/**
 * Terraform a challenge's AWS environment: one member account per competitor,
 * each solely administered by the competitor, with no cluster. Unlike the GCP
 * and Azure challenge paths — a single apply with for_each — this applies the
 * single-account root once per competitor, because Terraform can't create a
 * dynamic number of cross-account providers in one apply. Each competitor's
 * account has its own state under the run's aws prefix, keyed by account name,
 * so a challenge that grows only adds the new competitor's account.
 */
async function provisionAwsPerUser(
  run: RunRow,
): Promise<Record<string, unknown>> {
  const cfg = awsCfg();
  const workDir = path.join(TF_ROOT, AWS_CHALLENGE_TF_SOURCE);
  const emails = (await accountsFor(run.id)).map((a) => a.email);

  await log(
    run.id,
    "system",
    `Provisioning ${emails.length} AWS account(s), one per competitor ` +
      `(applied sequentially — account creation is slow and rate-limited)`,
  );

  const accountIds: Record<string, string> = {};
  const passwords: Record<string, string> = {};

  for (const email of emails) {
    const accountName = makeChallengeAwsAccountName(run.slug, run.id, email);
    const accountEmail = awsAccountEmail(accountName, cfg.accountEmailDomain);
    // Each competitor's account owns its own state object, keyed by the (unique)
    // account name, so the applies never clobber one another.
    const prefix = `${cloudStatePrefix(run.state_prefix, "aws")}/${accountName}`;

    await log(run.id, "system", `AWS account ${accountName} for ${email}`);
    writeAwsChallengeTfvars(workDir, run.id, accountName, accountEmail, email);

    await tfInit(workDir, stateBucket(), prefix, (l) =>
      log(run.id, l.stream, l.text),
    );
    await applyAwsWithRetry(run, workDir);

    const out = await tfOutput(workDir);
    if (typeof out.account_id === "string") accountIds[email] = out.account_id;
    if (typeof out.attendee_password === "string") {
      passwords[email] = out.attendee_password;
    }
  }

  return { aws_accounts: accountIds, aws_attendee_passwords: passwords };
}
