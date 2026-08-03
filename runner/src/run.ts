import path from "node:path";
import {
  awsAccountEmail,
  awsCfg,
  cloudStatePrefix,
  gcpCfg,
  stateBucket,
  TF_ROOT,
  challengeProjectMap,
  challengeResourceGroupMap,
  makeAwsAccountName,
  makeChallengeAwsAccountName,
  makeClusterName,
  makeProjectId,
  makeResourceGroupName,
} from "./config.js";
import {
  writeAwsChallengeTfvars,
  writeAwsTfvars,
  writeAzureChallengeTfvars,
  writeAzureTfvars,
  writeChallengeTfvars,
  writeTfvars,
} from "./workspace.js";
import { tfApply, tfInit, tfOutput } from "./terraform.js";
import { allocateEmails, createAccount, createOrgUnit } from "./directory.js";
import { displayName } from "./usernames.js";
import {
  createAttendeeRole,
  createOrg,
  createProject,
  grantAccountAdmin,
  grantOrgAttendee,
  grantProjectAdmin,
  orgIdentifier,
  orgUrl,
  projectIdentifier,
} from "./harness.js";
import {
  accountsFor,
  accountsWithPasswordsFor,
  addAccount,
  getRun,
  log,
  runCreatorEmail,
  setApplying,
  setFailed,
  setLiveError,
  setOrgUnitPath,
  setProvisioning,
  setReady,
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

/** Provision one workshop end to end: Workspace OU, accounts, then clouds. */
export async function runWorkshop(runId: string): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error(`run ${runId} not found`);

  try {
    await setProvisioning(runId);

    const orgUnitPath = await provisionAccounts(run);
    const outputs: Record<string, unknown> = {
      org_unit_path: orgUnitPath,
      user_count: run.user_count,
    };

    // Harness is provisioned for every workshop, not gated on a cloud, and
    // after the accounts exist because each attendee is invited by address.
    Object.assign(outputs, await provisionHarness(run));

    if (run.clouds.length === 0) {
      // No cloud selected — hand attendees the shared long-lived testing
      // project instead of building (and later destroying) a throwaway one.
      Object.assign(outputs, await provisionSandbox(run));
    } else {
      for (const cloud of run.clouds) {
        if (cloud === "gcp") {
          Object.assign(
            outputs,
            run.mode === "challenge"
              ? await provisionGcpPerUser(run)
              : await provisionGcp(run),
          );
        } else if (cloud === "azure") {
          Object.assign(
            outputs,
            run.mode === "challenge"
              ? await provisionAzurePerUser(run)
              : await provisionAzure(run),
          );
        } else if (cloud === "aws") {
          Object.assign(
            outputs,
            run.mode === "challenge"
              ? await provisionAwsPerUser(run)
              : await provisionAws(run),
          );
        }
      }
    }

    // Keep the original expiry when re-provisioning a workshop that grew —
    // editing its config must not silently extend how long it lives.
    const expiresAt =
      run.expires_at ?? new Date(Date.now() + run.ttl_seconds * 1000);
    await setReady(runId, outputs, expiresAt);
    await log(runId, "system", `Ready. Auto-destroys at ${expiresAt.toISOString()}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
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

/** Create the workshop's org unit and its attendee accounts. */
async function provisionAccounts(run: RunRow): Promise<string> {
  await log(run.id, "system", `Creating organizational unit "${run.name}"`);
  const orgUnitPath = await createOrgUnit(run.name);
  await setOrgUnitPath(run.id, orgUnitPath);
  await log(run.id, "system", `Org unit ready at ${orgUnitPath}`);

  // Accounts already handed out must keep their credentials, so only the
  // missing ones are created. This is what makes growing a workshop safe.
  const existing = new Set((await accountsFor(run.id)).map((a) => a.email));
  const todo = run.user_count - existing.size;

  if (todo <= 0) {
    await log(run.id, "system", `${existing.size} attendee account(s) already exist`);
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

  for (const email of emails) {
    const account = await createAccount({ email, orgUnitPath });
    await addAccount(run.id, account.email, account.tempPassword);
    await log(run.id, "stdout", `created ${account.email}`);
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

  for (const { email } of accounts) {
    const projectId = projectIdentifier(email);
    const { givenName, familyName } = displayName(email.split("@")[0] ?? email);

    await createProject(orgId, projectId, `${givenName} ${familyName}`);
    await grantProjectAdmin(orgId, projectId, email);
    await grantOrgAttendee(orgId, email);

    await log(run.id, "stdout", `${email} -> admin of project ${projectId}`);
  }

  return { harness_org: orgId, harness_org_url: orgUrl(orgId) };
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
  writeTfvars(workDir, projectId, run.id, attendees, clusterName);

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
  await tfApply(workDir, (l) => log(run.id, l.stream, l.text));

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
  writeTfvars(workDir, cfg.sandboxProjectId, run.id, attendees, clusterName);

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
  await tfApply(workDir, (l) => log(run.id, l.stream, l.text));

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
  await tfApply(workDir, (l) => log(run.id, l.stream, l.text));

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
    await tfApply(workDir, (l) => log(run.id, l.stream, l.text));

    const out = await tfOutput(workDir);
    if (typeof out.account_id === "string") accountIds[email] = out.account_id;
    if (typeof out.attendee_password === "string") {
      passwords[email] = out.attendee_password;
    }
  }

  return { aws_accounts: accountIds, aws_attendee_passwords: passwords };
}
