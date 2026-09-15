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
  makeHarnessIdentity,
  makeProjectId,
  makeResourceGroupName,
  regionFromLocation,
  PROVISION_LEAD_HOURS,
  SCENARIO_CONCURRENCY,
} from "./config.js";
import {
  writeAwsChallengeTfvars,
  writeAwsClusterTfvars,
  writeAwsCompetitorScenarioTfvars,
  writeAwsTfvars,
  writeAzureChallengeTfvars,
  writeAzureClusterTfvars,
  writeAzureScenarioTfvars,
  writeAzureTfvars,
  writeChallengeClusterTfvars,
  writeChallengeTfvars,
  writeDelegateTfvars,
  writeGcpCompetitorScenarioTfvars,
  writeScenarioTfvars,
  writeTfvars,
} from "./workspace.js";
import {
  activateApisFor,
  appliedScenarios,
  clusterStatePrefix,
  competitorSlug,
  hasScenarioRoot,
  needsCluster,
  resolveScenarios,
  scenarioStatePrefix,
  scenarioTfSource,
  scenarioWorkName,
  unknownScenarios,
  type Scenario,
} from "./scenarios.js";
import {
  tfApply,
  tfDestroy,
  tfInit,
  tfOutput,
  warmProviderCache,
  withWorkDir,
  type TfLine,
} from "./terraform.js";
import {
  awsAttemptOutcome,
  isGkeCapacityError,
  type AwsRetryKind,
} from "./classify.js";
import { issueAccessPass, tapPolicy } from "./graph.js";
import { allocateEmails, createAccount, createOrgUnit } from "./directory.js";
import { recordOutputResources } from "./resources.js";
import { mapConcurrent, summarize } from "./retry.js";
import { displayName } from "./usernames.js";
import { applyCatalog } from "./components.js";
import { copyOrgContent } from "./org-content.js";
import { applyOrgSecrets } from "./org-secrets.js";
import { importOrgRepos, projectRepoImporter } from "./repos.js";
import {
  createAttendeeRole,
  createOrg,
  createProject,
  ensureOrgDelegateToken,
  grantAccountAdmin,
  grantOrgAttendee,
  grantProjectAdmin,
  grantProjectViewer,
  latestDelegateImage,
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

/** Root config that creates one GKE cluster per challenge competitor. */
const GCP_CHALLENGE_GKE_TF_SOURCE = "challenges/gcp-per-user-gke";

/** APIs every challenge project gets, before any scenario asks for more. */
const CHALLENGE_BASELINE_APIS = ["compute.googleapis.com"];

/** Grant-only config: attendees get access to the shared long-lived project. */
const GCP_SANDBOX_TF_SOURCE = "workshops/gcp-sandbox";

/** Root config that creates the workshop's shared Azure resource group. */
const AZURE_TF_SOURCE = "workshops/azure-base";

/** Root config that creates one Azure resource group per challenge competitor. */
const AZURE_CHALLENGE_TF_SOURCE = "challenges/azure-per-user";

/** Root config that creates one AKS cluster per challenge competitor. */
const AZURE_CHALLENGE_AKS_TF_SOURCE = "challenges/azure-per-user-aks";

/** Root config that creates the workshop's single AWS member account. */
const AWS_TF_SOURCE = "workshops/aws-base";

/** Single-account root the runner applies once per AWS challenge competitor. */
const AWS_CHALLENGE_TF_SOURCE = "challenges/aws-per-user";

/** Single-cluster root, applied once per AWS challenge competitor. */
const AWS_CHALLENGE_EKS_TF_SOURCE = "challenges/aws-per-user-eks";

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

    // A sandbox run creates no Google Workspace accounts. It exists to apply a
    // handful of Harness entities and let their author try them, and throwaway
    // Workspace identities are neither needed for that nor free — the
    // contributor uses the address they signed in with.
    const orgUnitPath = run.harness_only ? null : await provisionAccounts(run);
    const outputs: Record<string, unknown> = {
      ...(orgUnitPath ? { org_unit_path: orgUnitPath } : {}),
      user_count: run.user_count,
    };

    /**
     * The cloud credentials, held apart from `outputs` for the whole run.
     *
     * They have to survive every pass — the component catalog is re-applied
     * after each cloud's apply, and a secret only converges if the value behind
     * it is still available — but they must never join `outputs`, which is
     * stored and displayed. Splitting them here is what lets both be true.
     */
    const credentials: Record<string, unknown> = {};
    const orgId = orgIdentifier(run.name, run.id);

    /**
     * Fold one apply's outputs into the run's, record what it built, and give
     * the component catalog its chance at whatever just became available.
     *
     * Recording happens while the build is still going because `outputs` itself
     * is only stored when the run goes ready, which is far too late to watch.
     */
    const merge = async (partial: Record<string, unknown>) => {
      for (const key of CREDENTIAL_OUTPUTS) {
        if (key in partial) {
          credentials[key] = partial[key];
          delete partial[key];
        }
      }
      Object.assign(outputs, partial);
      await recordOutputResources(run.id, partial);
      await applyCatalog(run, orgId, { ...outputs, ...credentials });
    };

    // Harness is provisioned for every workshop, not gated on a cloud, and
    // after the accounts exist because each attendee is invited by address.
    const harness = await provisionHarness(run);
    Object.assign(outputs, harness.outputs);

    // A first pass before any cloud exists: components that need nothing from
    // Terraform land now rather than waiting on an apply they do not depend on.
    // Everything else stays pending until the apply that provides its inputs.
    //
    // For a sandbox run this is also the *only* pass, since nothing below it
    // runs — which is why the result is kept rather than discarded.
    const first = await applyCatalog(run, orgId, { ...outputs, ...credentials });

    if (run.harness_only) {
      // A sandbox run: the org and the catalog, and nothing else. A component
      // needing a cloud credential stays pending, and saying so is the point —
      // "this one needs a GCP run to exercise" is a truthful result, where a
      // silent pass would let a contributor believe it had been tested.
      // Delegates are skipped along with the clusters they install into.
      await log(
        run.id,
        "system",
        `Harness-only run: ${first.applied.length} component(s) applied` +
          (first.pending.length
            ? `; ${first.pending.length} not exercised for want of a cloud ` +
              `credential (${first.pending.join(", ")})`
            : ""),
      );
    } else if (run.clouds.length === 0) {
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

    // Content that was held back when the org was made because it names a cloud
    // credential only an apply could mint. Those credentials exist now, and
    // every create here treats what already landed as "already there" — so this
    // picks up exactly what the first pass could not, and costs a re-listing
    // only when there was something to pick up. A run with nothing waiting,
    // which is most of them, skips it; so does a sandbox run, where no apply
    // happened and the same content would be held back for the same reason.
    if (harness.contentWaiting > 0 && !run.harness_only) {
      await copyOrgContent(run, orgId, "again");
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

  // An explicit HARNESS_DELEGATE_IMAGE wins; otherwise ask Harness which
  // delegate it currently supports, because the chart's default image is only
  // as fresh as the chart and Harness expires a delegate six months after its
  // release. Resolved once per run and shared by every cloud, so an event's
  // clusters all get the same delegate.
  let image = cfg.delegateImage;
  if (!image) {
    image = await latestDelegateImage();
    await log(
      run.id,
      image ? "stdout" : "stderr",
      image
        ? `Harness delegate image: ${image}`
        : "Could not determine the current Harness delegate version; " +
          "falling back to the Helm chart's default image, which may be old " +
          "enough for Harness to mark the delegate expired.",
    );
  }

  const common = {
    account_id: cfg.accountId,
    delegate_token: token,
    manager_endpoint: cfg.baseUrl,
    delegate_image: image,
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
        // Tagged with its cloud — every delegate in the event registers at the
        // same org scope, so the tag is what lets a lab's pipeline select the
        // delegate running in the cluster that lab is about.
        delegate_tags: target.cloud,
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
 * What the Harness half of a provision leaves behind: the outputs the run
 * stores, and how much of the site's content is still waiting on a credential
 * no cloud has minted yet. The second is not an output — it is over as soon as
 * the clouds are up — so it rides alongside rather than inside them.
 */
type HarnessProvision = {
  outputs: Record<string, unknown>;
  contentWaiting: number;
};

/**
 * Create the workshop's Harness organization and one project per attendee.
 *
 * Each attendee administers their own project and gets view/use access across
 * the org, so they can see everyone else's work without being able to change
 * it — plus read-only access to each project a project-scoped template source
 * brought across, which the org-level binding does not reach. Every call is
 * idempotent, so a grown or retried workshop only adds what is missing.
 */
async function provisionHarness(run: RunRow): Promise<HarnessProvision> {
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

  // The site's own secrets, before anything that might reference one. A catalog
  // connector naming `org.<identifier>` is refused if the secret is not there
  // yet, and the catalog's graph only orders components against each other.
  await applyOrgSecrets(run, orgId);

  // The site's authored content — templates, connectors, environments and their
  // infrastructure, org variables — from every source on Settings → Templates.
  // After the secrets for the same reason the catalog is: content that names an
  // org secret is refused if the secret is not there yet. Best-effort, and what
  // it left waiting on a cloud credential is copied again once the clouds are
  // up (see `runWorkshop`).
  const content = await copyOrgContent(run, orgId);

  // The repositories an administrator listed for the whole room. Best-effort:
  // one bad address is logged and left behind rather than costing the workshop
  // everything below it — see `repos.ts`.
  await importOrgRepos(run, orgId);

  // The org-scope binding every attendee gets references this role, so it has
  // to exist before anyone is bound to it.
  await createAttendeeRole(orgId);

  // Grant the run's creator account admin — the instructor role the reference
  // gives an event's owner. A creator without a recorded email is skipped
  // rather than failing the run.
  //
  // Never on a sandbox run. Its creator is whoever is testing components, which
  // is the one role that may be held by somebody outside the team, and account
  // admin is the whole Harness account — every organization, every other
  // workshop running at the time, the account's own settings. A contributor
  // gets a project inside their sandbox org and nothing above it, which is all
  // that exercising a component needs.
  const creator = await runCreatorEmail(run.id);
  if (run.harness_only) {
    await log(
      run.id,
      "system",
      "sandbox run — the creator gets a project in this org, not account admin",
    );
  } else if (creator) {
    await grantAccountAdmin(creator);
    await log(run.id, "stdout", `${creator} -> account admin (instructor)`);
  } else {
    await log(run.id, "system", "no creator email on file — skipping account admin");
  }

  // Who gets a project. Normally the attendee roster; on a sandbox run the
  // contributor themselves, under the address they signed in with, because no
  // Workspace accounts were created for a run that exists to exercise a
  // handful of Harness entities. They need somewhere to build a pipeline out
  // of the components being tested, and their own project is it.
  const accounts =
    run.harness_only
      ? creator
        ? [{ email: creator }]
        : []
      : await accountsFor(run.id);

  await log(
    run.id,
    "system",
    run.harness_only
      ? `Creating a Harness project for ${creator ?? "nobody — no creator email on file"}`
      : `Creating ${accounts.length} Harness project(s), one per attendee`,
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

  // Loaded once for the whole roster, then called with each project as it
  // lands, so the counted row spans the roster instead of one row per attendee.
  const importProjectRepos = await projectRepoImporter(
    run,
    orgId,
    accounts.length,
  );

  let built = 0;
  await countProjects(built);
  for (const { email } of accounts) {
    const projectId = projectIdentifier(email);
    const { givenName, familyName } = displayName(email.split("@")[0] ?? email);

    await createProject(orgId, projectId, `${givenName} ${familyName}`);
    // A `true` here is Harness answering "already a member" — the response it
    // sends *after* having applied the binding anyway (see `ALREADY_SATISFIED`
    // in harness.ts). Noted rather than ignored: the run rightly carries on, but
    // this is the one grant nobody watched land, so the log says whose it was.
    const alreadyProject = await grantProjectAdmin(orgId, projectId, email);
    const alreadyOrg = await grantOrgAttendee(orgId, email);
    if (alreadyProject || alreadyOrg) {
      await log(
        run.id,
        "stdout",
        `${email} was already a member of ${
          alreadyProject && alreadyOrg
            ? `project ${projectId} and org ${orgId}`
            : alreadyProject
              ? `project ${projectId}`
              : `org ${orgId}`
        } — Harness reported the binding as already applied`,
      );
    }
    // Read-only on each project a template source brought across. The org-wide
    // binding above stops at the org, so without this the content copied into
    // one of those projects would be invisible to the room it was copied for.
    for (const templateProject of content.projects) {
      await grantProjectViewer(orgId, templateProject, email);
    }

    projectUrls[email] = projectUrl(orgId, projectId);

    // After the grants, so an attendee whose project is still being wired up
    // never sees a repository they cannot open yet.
    await importProjectRepos(projectId);

    await log(
      run.id,
      "stdout",
      `${email} -> admin of project ${projectId}` +
        (content.projects.length > 0
          ? `, viewer of ${content.projects.join(", ")}`
          : ""),
    );
    await countProjects(++built);
  }

  return {
    outputs: {
      harness_org: orgId,
      harness_org_url: orgUrl(orgId),
      harness_project_urls: projectUrls,
    },
    contentWaiting: content.waiting,
  };
}

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
    // Held back rather than logged as it arrives, because whether a line is a
    // failure is not known until the attempt ends. Every AWS run trips the
    // warm-up race once — the account is ACTIVE the moment it exists but EC2
    // answers OptInRequired for another minute — and the attempt that hits it
    // goes on to succeed. Streaming that diagnostic live paints a red
    // `Error: ... not subscribed to this service` block into the log of a run
    // that is fine, which reads as a broken workshop and has been reported as
    // one. Once the attempt has ended the same lines can be logged at a
    // severity that reflects what actually happened.
    //
    // Nothing is lost by waiting. tofu writes stderr only at the end of an
    // apply, so there is no live output to delay; the progress a watcher wants
    // is on stdout and still streams. `exec` tees to this process's stderr
    // independently, so Cloud Logging keeps the unabridged copy either way.
    const held: string[] = [];
    try {
      await tfApply(workDir, (l) => {
        if (l.stream === "stderr") {
          held.push(l.text);
          return;
        }
        return log(run.id, l.stream, l.text);
      });
      // Exit 0, so anything on stderr was a warning, not a fault.
      await replay(run.id, held, "stdout");
      return;
    } catch (err) {
      const outcome = awsAttemptOutcome(held.join("\n"), attempts);
      if (outcome.action === "fail") {
        // Out of budget, or never retryable: this is the failure the run dies
        // on, so it is shown as one.
        await replay(run.id, held, "stderr");
        throw err;
      }

      attempts[outcome.kind]++;
      await log(
        run.id,
        "system",
        `AWS apply stopped because ${AWS_RETRY_REASONS[outcome.kind]}; ` +
          `retrying in ${outcome.delayMs / 1000}s.`,
      );
      await replay(run.id, held, "stdout");
      await wait(outcome.delayMs);
    }
  }
}

/**
 * Write back the stderr an attempt produced, at the severity its outcome
 * earned. Ordered after the `system` line that explains a retry, so the log
 * reads as the reason followed by its detail rather than an unexplained wall
 * of red.
 */
async function replay(
  runId: string,
  lines: string[],
  stream: "stdout" | "stderr",
): Promise<void> {
  for (const text of lines) await log(runId, stream, text);
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
 * carries a placement. A challenge with no scenario has no cluster, and so
 * nothing to pin and nothing that moving the region would disturb.
 */
function gcpRegionFor(run: RunRow): string {
  return regionFromLocation(recordedClusterLocation(run)) ?? gcpCfg().region;
}

/**
 * Where this run's GKE cluster was built, whichever shape recorded it.
 *
 * A workshop has one cluster and records `gke_cluster_location`. A challenge
 * whose scenarios needed clusters has one per competitor, recorded as the
 * `gke_cluster_locations` map — but they are applied as a single layer in a
 * single zone, so any entry answers for all of them.
 *
 * Both are read here because a challenge's clusters have to be pinned for the
 * same reason a workshop's are: re-applying a live event after the default
 * region moved must not destroy and rebuild the cluster someone is working in.
 */
function recordedClusterLocation(run: RunRow): unknown {
  const one = run.outputs?.gke_cluster_location;
  if (typeof one === "string") return one;

  const many = run.outputs?.gke_cluster_locations;
  if (many && typeof many === "object" && !Array.isArray(many)) {
    return Object.values(many as Record<string, unknown>)[0];
  }
  return undefined;
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
  const pinned = zoneLetterFromLocation(recordedClusterLocation(run), region);
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

/**
 * Outputs the cloud roots return their Harness connector's credential in.
 *
 * These are live administrator credentials. `run.outputs` is stored in the
 * database and rendered verbatim in the run page's "Raw outputs" card, and
 * neither is a place for them — so `runWorkshop` lifts these keys out of every
 * apply's outputs before merging the rest, and hands them to the component
 * catalog separately. Harness holds the only copy that outlives the apply
 * (Terraform state aside, which is where the attendee passwords already live).
 */
const CREDENTIAL_OUTPUTS = [
  "harness_gcp_key_json",
  "harness_azure_client_secret",
  "harness_aws_secret_access_key",
] as const;

/**
 * The name of the identity this run's connector for `cloud` authenticates as,
 * or "" when that cloud's connector is switched off — which is what makes the
 * Terraform create none. One name across all three clouds, so an event's
 * credentials are recognisably one event's.
 */
function harnessIdentityFor(run: RunRow, cloud: Cloud): string {
  const enabled = {
    gcp: () => gcpCfg().harnessConnectorEnabled,
    azure: () => azureCfg().harnessConnectorEnabled,
    aws: () => awsCfg().harnessConnectorEnabled,
  }[cloud];
  return enabled() ? makeHarnessIdentity(run.slug, run.id) : "";
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
      `${clusterName}, the Harness service account, and granting editor to ` +
      `${attendees.length} attendee(s)`,
  );
  await applyGkeWithZoneFailover(run, workDir, (zone) =>
    writeTfvars(workDir, projectId, run.id, attendees, {
      clusterName,
      zoneLetter: zone,
      region: gcpRegionFor(run),
      serviceAccountId: harnessIdentityFor(run, "gcp"),
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
      serviceAccountId: harnessIdentityFor(run, "gcp"),
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
 *
 * Selected scenarios are layered on afterwards: the cluster they need, then the
 * scenarios themselves, each on its own state prefix. This function builds only
 * the projects, because the container API it enables for them has to exist and
 * propagate before anything can be created inside one.
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
  const scenarios = resolveScenarios(run.scenarios);

  await log(
    run.id,
    "system",
    `Provisioning ${count} GCP project(s), one per competitor`,
  );

  // The union of what the selected scenarios need, on top of the baseline. With
  // nothing selected this is the baseline alone, which is the root's own default
  // — so a bare challenge builds what it always did.
  writeChallengeTfvars(
    workDir,
    run.id,
    projects,
    activateApisFor(CHALLENGE_BASELINE_APIS, scenarios),
  );

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

  const outputs = await tfOutput(workDir);

  // The cluster layer, then the scenarios that sit on it. Both read the same
  // project map this apply just built.
  const cluster = await provisionChallengeCluster(run, projects, scenarios);
  Object.assign(outputs, cluster);

  const mapOf = (key: string): Record<string, string> => {
    const v = cluster[key];
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, string>)
      : {};
  };
  const networkNames = mapOf("network_names");
  const nodeTags = mapOf("node_tags");
  const clusters = mapOf("gke_clusters");
  const locations = mapOf("gke_cluster_locations");
  const region = gcpRegionFor(run);

  Object.assign(
    outputs,
    await reconcileScenarios(run, "gcp", {
      emails: Object.keys(projects),
      writeRoster: (dir, scenario) =>
        writeScenarioTfvars(
          dir,
          run.id,
          scenario.id,
          projects,
          region,
          networkNames,
          nodeTags,
        ),
      writeOne: (dir, scenario, email) =>
        writeGcpCompetitorScenarioTfvars(dir, run.id, scenario.id, region, {
          email,
          projectId: projects[email],
          clusterName: clusters[email] ?? "",
          location: locations[email] ?? "",
          networkName: networkNames[email] ?? "",
          nodeTag: nodeTags[email] ?? "",
        }),
    }),
  );

  return outputs;
}

/**
 * Build one GKE cluster in every competitor's project, when a selected scenario
 * needs one.
 *
 * A bare challenge builds no cluster — standing one up is the challenge — so
 * this is a no-op unless a scenario says `requiresCluster`. Every competitor is
 * one `for_each` key in a single apply, so their clusters are built
 * concurrently rather than one after another; contrast the AWS challenge, which
 * has to apply once per competitor because it needs a provider per account.
 *
 * Zone failover is the workshop's (`applyGkeWithZoneFailover`): a zonal stockout
 * moves the whole layer to the next zone. Moving them together is deliberate —
 * competitors in one challenge should be racing on equal ground, not on whichever
 * zone had room.
 */
async function provisionChallengeCluster(
  run: RunRow,
  projects: Record<string, string>,
  scenarios: Scenario[],
): Promise<Record<string, unknown>> {
  if (!needsCluster(scenarios)) return {};

  const workDir = path.join(TF_ROOT, GCP_CHALLENGE_GKE_TF_SOURCE);
  const count = Object.keys(projects).length;
  const region = gcpRegionFor(run);

  await log(
    run.id,
    "system",
    `Provisioning ${count} GKE cluster(s), one per competitor, in parallel`,
  );

  await tfInit(
    workDir,
    stateBucket(),
    clusterStatePrefix(run.state_prefix),
    (l) => log(run.id, l.stream, l.text),
  );

  await applyGkeWithZoneFailover(run, workDir, (zone) =>
    writeChallengeClusterTfvars(workDir, run.id, projects, region, zone),
  );

  return tfOutput(workDir);
}

/**
 * Bring the run's scenario layers in line with what the organizer has selected:
 * apply the ones that are on, destroy the ones that have been switched off.
 *
 * The desired set is `run.scenarios`; what is actually standing is
 * `outputs.scenarios_applied`, recorded here. Reconciling against that recorded
 * set rather than against the whole catalog means unchecking a scenario costs
 * one destroy, and a run that never had a scenario costs nothing at all.
 *
 * Destroying a scenario must return the competitor's environment to working
 * order without disturbing anything else — which is why each scenario owns a
 * separate state prefix, and why the cluster underneath them is deliberately
 * left standing. Unchecking an issue is not a reason to delete the environment
 * someone is working in; that happens when the run is torn down.
 */
async function reconcileScenarios(
  run: RunRow,
  cloud: Cloud,
  ctx: ScenarioContext,
): Promise<Record<string, unknown>> {
  // A challenge runs on one cloud, but filtering by it anyway means a run whose
  // cloud was changed before it was ever built does not try to apply the old
  // cloud's scenarios against the new cloud's environment.
  const selected = resolveScenarios(run.scenarios).filter(
    (s) => s.cloud === cloud,
  );
  const previous = appliedScenarios(run.outputs);
  const wanted = new Set(selected.map((s) => s.id));
  const removed = resolveScenarios(previous).filter((s) => !wanted.has(s.id));

  if (selected.length === 0 && removed.length === 0) return {};

  const missing = unknownScenarios([...run.scenarios, ...previous]);
  if (missing.length > 0) {
    await log(
      run.id,
      "stderr",
      `This challenge selected scenario(s) this build no longer ships ` +
        `(${[...new Set(missing)].join(", ")}), so they were skipped. Anything ` +
        `they built earlier is still standing and will be removed when the run ` +
        `is torn down.`,
    );
  }

  const outputs: Record<string, unknown> = {};

  // Off first: a scenario being switched off and another switched on in the
  // same save should not have the incoming one's rules briefly overlap the
  // outgoing one's.
  for (const scenario of removed) {
    await log(run.id, "system", `Removing scenario ${scenario.label}`);
    await runScenario(run, scenario, ctx, "destroy");
  }

  for (const scenario of selected) {
    await log(run.id, "system", `Applying scenario ${scenario.label}`);
    Object.assign(outputs, await runScenario(run, scenario, ctx, "apply"));
  }

  // What is standing now, for the next reconcile to diff against. Ids the
  // current build cannot resolve are carried through rather than dropped: their
  // layers really are still standing, and forgetting them here is how they get
  // left behind at teardown.
  outputs.scenarios_applied = [
    ...selected.map((s) => s.id),
    ...unknownScenarios(previous),
  ];
  return outputs;
}

/**
 * Apply or destroy one scenario, in whichever of the two shapes it declares.
 *
 * A roster scenario is a single apply that `for_each`es over every competitor.
 * A `perCompetitor` one is an apply each — because its provider cannot be
 * instantiated more than once in a single configuration, which is true of an
 * AWS cross-account role and of the `kubernetes`/`helm` providers alike. Those
 * run concurrently: independent environments, and the wait is otherwise
 * multiplied by the size of the room.
 */
async function runScenario(
  run: RunRow,
  scenario: Scenario,
  ctx: ScenarioContext,
  action: "apply" | "destroy",
): Promise<Record<string, unknown>> {
  // The cluster scenarios are manifests only — the cluster layer above has
  // already built (or not built) what they ask for, and there is nothing else
  // to apply. Applying a layer would create an empty state object.
  if (!hasScenarioRoot(scenario)) return {};

  const source = scenarioTfSource(scenario.id);
  const bucket = stateBucket();
  const line = (l: TfLine) => log(run.id, l.stream, l.text);

  if (!scenario.perCompetitor) {
    const workDir = path.join(TF_ROOT, source);
    ctx.writeRoster(workDir, scenario);
    await tfInit(
      workDir,
      bucket,
      scenarioStatePrefix(run.state_prefix, scenario.id),
      line,
    );
    if (action === "destroy") {
      await tfDestroy(workDir, line);
      return {};
    }
    await tfApply(workDir, line);
    return tfOutput(workDir);
  }

  // One apply per competitor, each against its own copy of the root and its own
  // state prefix. The copy is what makes concurrency possible at all: a shared
  // directory would have them overwriting each other's tfvars.
  //
  // The provider cache is populated once, serially, before the copies race for
  // it — see `warmProviderCache`.
  await warmProviderCache(
    source,
    bucket,
    scenarioStatePrefix(run.state_prefix, scenario.id),
  );

  await log(
    run.id,
    "system",
    `${action === "apply" ? "Applying" : "Removing"} ${scenario.label} for ` +
      `${ctx.emails.length} competitor(s), ${SCENARIO_CONCURRENCY} at a time`,
  );

  const perCompetitor = await mapConcurrent(
    ctx.emails,
    SCENARIO_CONCURRENCY,
    async (email) => {
      const slug = competitorSlug(email);
      return withWorkDir(
        source,
        scenarioWorkName(run.id, scenario.id, slug),
        async (workDir) => {
          ctx.writeOne(workDir, scenario, email);
          await tfInit(
            workDir,
            bucket,
            scenarioStatePrefix(run.state_prefix, scenario.id, slug),
            line,
          );
          if (action === "destroy") {
            await tfDestroy(workDir, line);
            return {};
          }
          await tfApply(workDir, line);
          return tfOutput(workDir);
        },
      );
    },
  );

  // Per-competitor outputs are merged under the competitor's address, so two
  // competitors' values for the same output name do not overwrite each other.
  if (action === "destroy") return {};
  const byCompetitor: Record<string, unknown> = {};
  ctx.emails.forEach((email, i) => {
    byCompetitor[email] = perCompetitor[i];
  });
  return { [`scenario_${scenario.id.replace(/-/g, "_")}`]: byCompetitor };
}

/**
 * What a cloud's provisioning path hands the scenario reconciler: who the
 * competitors are, and how to write tfvars for that cloud in each of the two
 * shapes.
 *
 * The reconcile logic — diffing selected against standing, the ordering, the
 * concurrency — is identical on every cloud; only the variables differ. Passing
 * the writers in keeps it that way instead of growing a switch per cloud.
 */
type ScenarioContext = {
  emails: string[];
  writeRoster: (workDir: string, scenario: Scenario) => void;
  writeOne: (workDir: string, scenario: Scenario, email: string) => void;
};


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
        `not accept on its own. Reading the policy needs the Graph application ` +
        `permission Policy.Read.AuthenticationMethod; issuing the passes then ` +
        `needs UserAuthenticationMethod.ReadWrite.All. Grant both on the ` +
        `runner's app registration, admin-consented — a 403 here usually means ` +
        `the first one is missing. ${summarize(err)}`,
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
  writeAzureTfvars(
    workDir,
    run.id,
    resourceGroup,
    clusterName,
    attendees,
    harnessIdentityFor(run, "azure"),
  );

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
      `Entra user(s), the AKS cluster ${clusterName}, the Harness app ` +
      `registration, and Contributor grants`,
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

  const outputs = await tfOutput(workDir);

  // The cluster layer, then the scenarios that sit on it — the same order and
  // for the same reasons as the GCP path.
  const scenarios = resolveScenarios(run.scenarios).filter(
    (s) => s.cloud === "azure",
  );
  const cluster = await provisionAzureChallengeCluster(run, groups, scenarios);
  Object.assign(outputs, cluster);

  const mapOf = (key: string): Record<string, string> => {
    const v = cluster[key];
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, string>)
      : {};
  };
  const subnetIds = mapOf("subnet_ids");
  const clusterNames = mapOf("aks_clusters");

  Object.assign(
    outputs,
    await reconcileScenarios(run, "azure", {
      emails: Object.keys(groups),
      writeRoster: (dir, scenario) =>
        writeAzureScenarioTfvars(
          dir,
          run.id,
          scenario.id,
          groups,
          subnetIds,
          clusterNames,
        ),
      // No per-competitor Azure scenario ships yet; a future in-cluster one
      // would take this path, and the resource group is what identifies a
      // competitor's environment.
      writeOne: (dir, scenario, email) =>
        writeAzureScenarioTfvars(
          dir,
          run.id,
          scenario.id,
          { [email]: groups[email] },
          { [email]: subnetIds[email] ?? "" },
          { [email]: clusterNames[email] ?? "" },
        ),
    }),
  );

  return outputs;
}

/**
 * Build an AKS cluster in every competitor's resource group, when a selected
 * scenario needs one.
 *
 * One apply covering every competitor, unlike AWS: the resource groups all live
 * in the same subscription, so a single provider reaches them and Terraform
 * builds the clusters concurrently within the apply.
 */
async function provisionAzureChallengeCluster(
  run: RunRow,
  groups: Record<string, string>,
  scenarios: Scenario[],
): Promise<Record<string, unknown>> {
  if (!needsCluster(scenarios)) return {};

  const workDir = path.join(TF_ROOT, AZURE_CHALLENGE_AKS_TF_SOURCE);
  const count = Object.keys(groups).length;

  await log(
    run.id,
    "system",
    `Provisioning ${count} AKS cluster(s), one per competitor, in parallel`,
  );

  writeAzureClusterTfvars(workDir, run.id, groups);
  await tfInit(
    workDir,
    stateBucket(),
    clusterStatePrefix(cloudStatePrefix(run.state_prefix, "azure")),
    (l) => log(run.id, l.stream, l.text),
  );
  await tfApply(workDir, (l) => log(run.id, l.stream, l.text));

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
    harnessIdentityFor(run, "aws"),
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
      `EKS cluster ${clusterName}, the Harness IAM user, and PowerUser grants`,
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
  const aliases: Record<string, string> = {};
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
    if (typeof out.account_alias === "string") aliases[email] = out.account_alias;
    if (typeof out.attendee_password === "string") {
      passwords[email] = out.attendee_password;
    }
  }

  // `cfg.region`, not a Terraform output: this root's outputs are assembled by
  // hand rather than passed through, and every account in the loop was applied
  // from the same tfvars region. Recorded so the attendee page opens each
  // competitor's console in the region their environment was built in.
  const outputs: Record<string, unknown> = {
    aws_accounts: accountIds,
    aws_account_aliases: aliases,
    aws_attendee_passwords: passwords,
    aws_region: cfg.region,
  };

  // The cluster layer, then the scenarios on it. Both need the account ids the
  // loop above collected, which is why they run here rather than beside the
  // other clouds' — there is nothing to assume into until the accounts exist.
  const scenarios = resolveScenarios(run.scenarios).filter(
    (s) => s.cloud === "aws",
  );
  const clusters = await provisionAwsChallengeCluster(run, accountIds, scenarios);
  Object.assign(outputs, clusters.outputs);

  Object.assign(
    outputs,
    await reconcileScenarios(run, "aws", {
      // Only competitors whose account actually came up. One that failed has
      // nothing to assume into, and asking for it would fail the whole layer
      // rather than the one competitor already in trouble.
      emails: Object.keys(accountIds),
      // Every AWS scenario is perCompetitor — a cross-account provider cannot
      // be built dynamically — so nothing takes this path. It is here so that a
      // roster-shaped AWS scenario fails loudly at apply rather than silently
      // writing tfvars nothing declares.
      writeRoster: (dir, scenario) =>
        writeAwsCompetitorScenarioTfvars(dir, run.id, scenario.id, "", "", ""),
      writeOne: (dir, scenario, email) =>
        writeAwsCompetitorScenarioTfvars(
          dir,
          run.id,
          scenario.id,
          email,
          accountIds[email],
          clusters.names[email] ?? "",
        ),
    }),
  );

  return outputs;
}

/**
 * Build an EKS cluster in every competitor's account, when a selected scenario
 * needs one.
 *
 * One apply per competitor — the account boundary again — but run concurrently,
 * which matters more here than anywhere else: an EKS cluster takes something
 * like fifteen minutes, so five competitors done one after another would spend
 * an hour and a quarter of a challenge's life building. Concurrently it is
 * roughly the time of one.
 *
 * The account creation above stays sequential. That is not inconsistency: AWS
 * rate-limits account creation specifically, and it is the one step where
 * running in parallel reliably makes things slower.
 */
async function provisionAwsChallengeCluster(
  run: RunRow,
  accountIds: Record<string, string>,
  scenarios: Scenario[],
): Promise<{ outputs: Record<string, unknown>; names: Record<string, string> }> {
  if (!needsCluster(scenarios)) return { outputs: {}, names: {} };

  const emails = Object.keys(accountIds);
  const bucket = stateBucket();
  const base = cloudStatePrefix(run.state_prefix, "aws");
  const line = (l: TfLine) => log(run.id, l.stream, l.text);

  await log(
    run.id,
    "system",
    `Provisioning ${emails.length} EKS cluster(s), one per competitor, ` +
      `${SCENARIO_CONCURRENCY} at a time`,
  );

  await warmProviderCache(AWS_CHALLENGE_EKS_TF_SOURCE, bucket, `${base}/cluster`);

  const built = await mapConcurrent(
    emails,
    SCENARIO_CONCURRENCY,
    async (email) => {
      const slug = competitorSlug(email);
      const clusterName = makeChallengeAwsAccountName(run.slug, run.id, email);
      return withWorkDir(
        AWS_CHALLENGE_EKS_TF_SOURCE,
        scenarioWorkName(run.id, "eks", slug),
        async (workDir) => {
          writeAwsClusterTfvars(
            workDir,
            run.id,
            email,
            accountIds[email],
            clusterName,
          );
          await tfInit(workDir, bucket, `${base}/cluster/${slug}`, line);
          await tfApply(workDir, line);
          return { email, name: clusterName };
        },
      );
    },
  );

  const names = Object.fromEntries(built.map((b) => [b.email, b.name]));
  return { outputs: { eks_clusters: names }, names };
}
