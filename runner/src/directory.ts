import crypto from "node:crypto";
import { google, type admin_directory_v1 } from "googleapis";
import { workspaceCfg } from "./config.js";
import { COMBINATIONS, displayName, randomUsername } from "./usernames.js";
import { withRetry } from "./retry.js";

/**
 * Optional progress sink for retry notices. `run.ts` passes one so a room
 * watching the live log sees "Google … retrying" instead of a silent stall;
 * callers without a run to log to (the reaper, allocation pre-checks) leave it
 * out and the notice goes to the container log only.
 */
export type RetryNotify = (message: string) => void | Promise<void>;

/**
 * Call the Google Admin SDK with backoff on its transient 5xx/rate-limit
 * blips. A non-transient error (a 409 we adopt, a 404 we treat as gone) is
 * re-thrown unchanged so the idempotency checks below still see its status.
 */
function directoryCall<T>(
  label: string,
  notify: RetryNotify | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return withRetry(fn, {
    label: `Google Workspace Directory (${label})`,
    onRetry: async ({ attempt, attempts, delayMs, summary }) => {
      const line =
        `Google Workspace Directory (${label}): ${summary}; retrying ` +
        `in ${Math.round(delayMs / 1000)}s (attempt ${attempt} of ${attempts - 1})`;
      console.warn(line);
      await notify?.(line);
    },
  });
}

const SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.orgunit",
  "https://www.googleapis.com/auth/admin.directory.user",
];

const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Re-mint a delegated token this long before it actually expires. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

let delegated: { token: string; expiresAt: number } | undefined;

/**
 * Mint an access token that acts as `adminEmail`, without a key file.
 *
 * Domain-wide delegation normally rides on `clientOptions.subject`, but that
 * only reaches a `JWT` client, which GoogleAuth builds only from a key file.
 * On Cloud Run, ADC resolves to the metadata-server `Compute` client instead —
 * and `Compute` reads just `serviceAccountEmail` and `scopes` from its options,
 * so `subject` is dropped in silence. The Admin SDK then sees runner-sa acting
 * as itself; a bare service account belongs to no Workspace customer, so
 * `my_customer` resolves to nothing and every Directory call fails with
 * "Invalid Customer Id" — a message about the customer, for a problem with the
 * caller.
 *
 * So the assertion is assembled here: build the delegation claim set, have IAM
 * Credentials sign it with the service account's Google-managed key, and trade
 * it at the token endpoint. Exactly the grant a key file would produce, with
 * no key material anywhere.
 */
async function delegatedToken(adminEmail: string): Promise<string> {
  if (delegated && Date.now() < delegated.expiresAt - REFRESH_SKEW_MS) {
    return delegated.token;
  }

  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const signer = await signerAddress(auth);

  const iat = Math.floor(Date.now() / 1000);
  const claims = {
    iss: signer,
    sub: adminEmail, // the super-admin whose authority is being borrowed
    scope: SCOPES.join(" "),
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600,
  };

  const iam = google.iamcredentials({ version: "v1", auth });

  // Both the IAM sign and the token exchange can hit a transient Google 5xx;
  // retry the pair. A refused delegation is a 4xx and non-transient, so it is
  // surfaced on the first try rather than retried three more times.
  delegated = await withRetry(
    async () => {
      const signed = await iam.projects.serviceAccounts.signJwt({
        // `-` lets IAM find the owning project from the address.
        name: `projects/-/serviceAccounts/${signer}`,
        requestBody: { payload: JSON.stringify(claims) },
      });
      const assertion = signed.data.signedJwt;
      if (!assertion) throw new Error("signJwt returned no assertion");

      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        expires_in?: number;
        error?: string;
        error_description?: string;
      };
      if (!res.ok || !body.access_token) {
        if (res.status >= 500 || res.status === 429) {
          // Transient — let withRetry back off. The status rides on the error
          // so `isTransient` recognises it (a bare fetch throws nothing here).
          throw Object.assign(
            new Error(`token endpoint returned HTTP ${res.status}`),
            { status: res.status },
          );
        }
        // `unauthorized_client` means the Workspace Admin console has not
        // granted this service account's client ID the scopes above. That is
        // the half of the setup that lives outside GCP, and no amount of IAM
        // substitutes for it — so name it rather than letting a bare 401 stand.
        throw new Error(
          `Workspace delegation to ${adminEmail} was refused ` +
            `(${body.error ?? res.status}${
              body.error_description ? `: ${body.error_description}` : ""
            }). Check that ${signer}'s client ID is authorized for ` +
            `${SCOPES.join(", ")} in Admin console -> Security -> API controls -> ` +
            `Domain-wide delegation.`,
        );
      }

      return {
        token: body.access_token,
        expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
      };
    },
    { label: "Google Workspace delegation" },
  );
  return delegated.token;
}

/** The service account that signs the assertion — the runner's own, normally. */
async function signerAddress(auth: InstanceType<typeof google.auth.GoogleAuth>) {
  const configured = workspaceCfg().delegateServiceAccount;
  if (configured) return configured;

  // Throws when ADC is a user credential, which carries no service account.
  const { client_email: inferred } = await auth.getCredentials().catch(() => ({
    client_email: undefined,
  }));
  if (!inferred) {
    throw new Error(
      "no service account to sign the Workspace delegation with — running " +
        "under user credentials? set GOOGLE_WORKSPACE_DELEGATE_SA to the " +
        "runner service account and grant yourself " +
        "roles/iam.serviceAccountTokenCreator on it",
    );
  }
  return inferred;
}

/**
 * Admin SDK client acting as the super-admin. The Directory API refuses
 * service-account identities acting as themselves, so every call here is made
 * under domain-wide delegation.
 */
async function directory(): Promise<admin_directory_v1.Admin> {
  const { adminEmail } = workspaceCfg();

  // Use googleapis' own auth export — the runner's direct google-auth-library
  // dependency is a different copy and its types are not interchangeable.
  const auth = new google.auth.GoogleAuth({
    scopes: SCOPES,
    clientOptions: { subject: adminEmail },
  });

  // A key file yields a JWT client, which honours `subject` by itself. Anything
  // else (Cloud Run's metadata server) silently ignores it, so mint the
  // delegated token by hand.
  if ((await auth.getClient()) instanceof google.auth.JWT) {
    return google.admin({ version: "directory_v1", auth });
  }

  const client = new google.auth.OAuth2();
  client.setCredentials({ access_token: await delegatedToken(adminEmail) });
  return google.admin({ version: "directory_v1", auth: client });
}

/** HTTP status of a googleapis error, if it carries one. */
function statusOf(err: unknown): number | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? Number((err as { code: unknown }).code)
    : undefined;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Deleting an OU's users is eventually consistent: for a short while after the
 * last user is deleted, the OU can still report members and refuse to delete
 * (HTTP 412, "Cannot delete OrgUnit with following members: Users"). So
 * sweep-and-delete is tried a few times with a pause between, converging within
 * one reaper tick rather than waiting for the next one.
 *
 * Measured against harnessevents.io, a member deleted seconds earlier kept the
 * OU undeletable for ~30s. The first sizing here — four attempts 5s apart, so
 * 15s of patience — was inside that, which turned a teardown that only needed
 * waiting into a flagged failure. 70s is the margin now.
 */
const OU_DELETE_ATTEMPTS = 8;
const OU_DELETE_BACKOFF_MS = 10_000;

/**
 * How long a *just-created* OU is given to become visible to `users.insert`.
 *
 * `orgunits.insert` returning does not mean the new OU is usable yet: for a few
 * seconds, a user creation naming it comes back 403 "Not Authorized to access
 * this resource/api" — the same answer Google gives an admin who genuinely may
 * not create users. Probed against harnessevents.io, an insert 0.4s after the
 * OU was created was refused and the same insert 12s later succeeded.
 *
 * The workshops that walk into this are the small ones. Between creating the OU
 * and the first insert, a run only does its per-seat address checks
 * (`allocateEmails`), so a 30-seat workshop spends seconds there and clears the
 * window by accident, while a 1-seat workshop arrives in under half a second.
 * Three 1-seat runs failed this way on 2026-09-08 before it was understood.
 */
const OU_VISIBLE_ATTEMPTS = 8;
const OU_VISIBLE_BACKOFF_MS = 5000;

/**
 * How long a just-created account is given before its deletion is accepted.
 * Google refuses one with 412 "User creation is not complete." — the other side
 * of the same window `OU_VISIBLE_ATTEMPTS` waits out, met when a failed run is
 * deleted straight away (see `deleteUserOnceCreated`).
 */
const USER_DELETE_ATTEMPTS = 6;
const USER_DELETE_BACKOFF_MS = 5000;

function joinOrgUnitPath(parent: string, name: string): string {
  const base = parent.endsWith("/") ? parent.slice(0, -1) : parent;
  return `${base}/${name}`;
}

/**
 * Create the workshop's organizational unit, named after the workshop.
 * Idempotent: an existing OU at the same path is reused so a retried run does
 * not fail. Returns the full org unit path.
 */
export async function createOrgUnit(
  name: string,
  notify?: RetryNotify,
): Promise<string> {
  const svc = await directory();
  const { customerId, parentOrgUnitPath } = workspaceCfg();
  const path = joinOrgUnitPath(parentOrgUnitPath, name);
  const key = path.replace(/^\//, "");

  try {
    const res = await directoryCall("create OU", notify, () =>
      svc.orgunits.insert({
        customerId,
        requestBody: { name, parentOrgUnitPath },
      }),
    );
    return res.data.orgUnitPath ?? path;
  } catch (err) {
    // The OU may already exist — a grown or retried workshop re-runs this. The
    // Directory API is not consistent about how it reports that: a 409 on some
    // paths, a 400 "Invalid Ou Id" on others (which is what breaks a grow of a
    // ready workshop). So don't trust the status — look. If the OU is there,
    // adopt it; only if it genuinely is not do we surface the insert error.
    try {
      const existing = await directoryCall("look up OU", notify, () =>
        svc.orgunits.get({ customerId, orgUnitPath: key }),
      );
      if (existing.data.orgUnitPath) return existing.data.orgUnitPath;
    } catch (getErr) {
      if (statusOf(getErr) !== 404) throw getErr;
    }
    throw err;
  }
}

/** Every user currently in an OU (and its sub-OUs), by primary email. */
async function listOrgUnitUsers(
  svc: admin_directory_v1.Admin,
  orgUnitPath: string,
): Promise<string[]> {
  const { customerId } = workspaceCfg();
  const emails: string[] = [];
  let pageToken: string | undefined;
  do {
    const res = await directoryCall("list OU users", undefined, () =>
      svc.users.list({
        customer: customerId,
        query: `orgUnitPath='${orgUnitPath}'`,
        maxResults: 200,
        pageToken,
      }),
    );
    for (const u of res.data.users ?? []) {
      if (u.primaryEmail) emails.push(u.primaryEmail);
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return emails;
}

/**
 * Delete one user, tolerating Google's consistency at both ends of the
 * account's life: a 404 means it is already gone, and a 412 "User creation is
 * not complete." is what a delete gets for an account created moments ago.
 *
 * That 412 is not hypothetical for a workshop. Deleting a run is what an
 * instructor does the moment a provision fails, and the run's accounts may then
 * be seconds old — so without this the cleanup for a broken workshop is itself
 * broken, and the run is flagged for a condition that clears on its own.
 */
export async function deleteUserOnceCreated(
  del: () => Promise<unknown>,
  email: string,
  /** Injectable so the wait loop can be tested without real delays. */
  pause: (ms: number) => Promise<void> = sleep,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await del();
      return;
    } catch (err) {
      const status = statusOf(err);
      if (status === 404) return; // already gone
      if (status !== 412 || attempt >= USER_DELETE_ATTEMPTS) throw err;
      const line =
        `Google Workspace Directory (delete user): ${email} was created too ` +
        `recently to delete; retrying in ` +
        `${Math.round(USER_DELETE_BACKOFF_MS / 1000)}s (attempt ${attempt} of ` +
        `${USER_DELETE_ATTEMPTS - 1})`;
      console.warn(line);
      await pause(USER_DELETE_BACKOFF_MS);
    }
  }
}

/**
 * Empty and delete a workshop's OU.
 *
 * Deletes whoever is *actually* in the OU, not just the accounts on record —
 * a create that failed after Google had already made the account (a gateway
 * 502 on `users.insert`, say) leaves an untracked user here, and Google will
 * not delete an OU that still has members. Reading the OU's real membership is
 * what lets teardown clear that orphan; the run's own roster never knew about
 * it. Idempotent: a 404 (already gone) at any step is success.
 */
export async function deleteOrgUnit(orgUnitPath: string): Promise<void> {
  const svc = await directory();
  const key = orgUnitPath.replace(/^\//, "");

  for (let attempt = 1; attempt <= OU_DELETE_ATTEMPTS; attempt++) {
    const users = await listOrgUnitUsers(svc, orgUnitPath);
    for (const email of users) {
      await deleteUserOnceCreated(
        () =>
          directoryCall("delete OU user", undefined, () =>
            svc.users.delete({ userKey: email }),
          ),
        email,
      );
    }

    try {
      await directoryCall("delete OU", undefined, () =>
        svc.orgunits.delete({ customerId: workspaceCfg().customerId, orgUnitPath: key }),
      );
      return;
    } catch (err) {
      if (statusOf(err) === 404) return; // already gone
      // Only the "still has members" case is worth another sweep — the just-
      // deleted users may not have propagated yet. Anything else is a real
      // failure and should surface for the reaper to retry the whole run. The
      // status (412) and the message are both checked because Google states the
      // condition in prose, and prose is the half that can be reworded.
      const message = err instanceof Error ? err.message : String(err);
      const stillPopulated = statusOf(err) === 412 || /member/i.test(message);
      if (attempt >= OU_DELETE_ATTEMPTS || !stillPopulated) throw err;
      await sleep(OU_DELETE_BACKOFF_MS);
    }
  }
}

/**
 * A random temporary password valid in every cloud directory an attendee might
 * be created in — Google Workspace, Microsoft Entra ID, and AWS IAM — so the
 * one credential works across all clouds a workshop selects. base64url emits
 * only [A-Za-z0-9-_], all of which each cloud accepts, and the appended `aA1!`
 * guarantees the upper/lower/digit/symbol mix Entra and AWS can require. The
 * 20-char result is within every cloud's length cap (AWS's is the lowest, 128).
 */
function generatePassword(): string {
  return crypto.randomBytes(12).toString("base64url").slice(0, 16) + "aA1!";
}

export type CreatedAccount = { email: string; tempPassword: string };

/**
 * Run a `users.insert` that names a freshly created OU, waiting out the 403 that
 * OU's invisibility produces (see `OU_VISIBLE_ATTEMPTS`).
 *
 * Only 403 is waited on, and only for as long as the window lasts. Everything
 * else — the 409 that means "someone already has this address", which the caller
 * adopts — is re-thrown on the first attempt, unchanged, so the status checks
 * around this still see what Google actually said.
 *
 * If the 403 outlives the window it is no longer plausibly the race, so the
 * error names the other cause: the impersonated admin may genuinely not be
 * allowed to create users. Both readings are given because Google's answer does
 * not distinguish them and the operator's next move differs completely.
 */
export async function insertIntoNewOrgUnit<T>(
  insert: () => Promise<T>,
  ctx: { email: string; orgUnitPath: string; notify?: RetryNotify },
  /** Injectable so the wait loop can be tested without real delays. */
  pause: (ms: number) => Promise<void> = sleep,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await insert();
    } catch (err) {
      if (statusOf(err) !== 403) throw err;

      if (attempt >= OU_VISIBLE_ATTEMPTS) {
        const waited = Math.round(
          ((OU_VISIBLE_ATTEMPTS - 1) * OU_VISIBLE_BACKOFF_MS) / 1000,
        );
        throw new Error(
          `Google Workspace refused to create ${ctx.email} in ` +
            `${ctx.orgUnitPath} with 403 "Not Authorized" for ${waited}s. A ` +
            `newly created org unit is invisible to user creation for a few ` +
            `seconds, so this normally clears itself; that it did not suggests ` +
            `${workspaceCfg().adminEmail} is not allowed to create users — ` +
            `check its admin role in Admin console -> Account -> Admin roles.`,
        );
      }

      const line =
        `Google Workspace Directory (create user): the new org unit ` +
        `${ctx.orgUnitPath} is not visible yet; retrying in ` +
        `${Math.round(OU_VISIBLE_BACKOFF_MS / 1000)}s (attempt ${attempt} of ` +
        `${OU_VISIBLE_ATTEMPTS - 1})`;
      console.warn(line);
      await ctx.notify?.(line);
      await pause(OU_VISIBLE_BACKOFF_MS);
    }
  }
}

/**
 * Create one attendee account inside the workshop's OU. The display name is
 * derived from the generated username, so `bouncypenguin@…` shows up as
 * "Bouncypenguin".
 */
export async function createAccount(
  input: {
    email: string;
    orgUnitPath: string;
  },
  notify?: RetryNotify,
): Promise<CreatedAccount> {
  const svc = await directory();
  const tempPassword = generatePassword();

  const body: admin_directory_v1.Schema$User = {
    primaryEmail: input.email,
    name: displayName(localPartOf(input.email)),
    password: tempPassword,
    // Do not force a change at first login. The same credential is meant to
    // work across every cloud a workshop selects (GCP, Azure, AWS); if each
    // cloud forced its own reset the passwords would diverge the moment the
    // attendee signed into any one of them. It stays the issued temp password
    // for the workshop's short, time-boxed life.
    changePasswordAtNextLogin: false,
    orgUnitPath: input.orgUnitPath,
  };

  try {
    await insertIntoNewOrgUnit(
      () =>
        directoryCall("create user", notify, () =>
          svc.users.insert({ requestBody: body }),
        ),
      { email: input.email, orgUnitPath: input.orgUnitPath, notify },
    );
  } catch (err) {
    if (statusOf(err) !== 409) throw err;
    // Someone got this address between the availability check and here. If it
    // sits in this workshop's OU it is ours — an earlier attempt that crashed
    // before recording it — so adopt it. Anywhere else it belongs to a real
    // person, and resetting their password would lock them out.
    const existing = await directoryCall("look up user", notify, () =>
      svc.users.get({ userKey: input.email }),
    );
    if (existing.data.orgUnitPath !== input.orgUnitPath) {
      throw new Error(
        `address ${input.email} is already in use outside ${input.orgUnitPath}`,
      );
    }
    await directoryCall("update user", notify, () =>
      svc.users.update({ userKey: input.email, requestBody: body }),
    );
  }
  return { email: input.email, tempPassword };
}

export async function deleteAccount(email: string): Promise<void> {
  const svc = await directory();
  await deleteUserOnceCreated(
    () =>
      directoryCall("delete user", undefined, () =>
        svc.users.delete({ userKey: email }),
      ),
    email,
  );
}

function localPartOf(email: string): string {
  return email.split("@")[0] ?? email;
}

/** Address for a generated username, e.g. `bouncypenguin@example.com`. */
export function usernameEmail(username: string): string {
  return `${username}@${workspaceCfg().domain}`;
}

/** Whether an address is already taken anywhere in the domain. */
export async function accountExists(email: string): Promise<boolean> {
  const svc = await directory();
  try {
    await directoryCall("check address", undefined, () =>
      svc.users.get({ userKey: email }),
    );
    return true;
  } catch (err) {
    if (statusOf(err) === 404) return false;
    throw err;
  }
}

/**
 * How many names to try before widening the search with a numeric suffix. The
 * namespace is large, so needing this many means the domain is crowded rather
 * than that we were unlucky.
 */
const PLAIN_ATTEMPTS = 12;
const MAX_ATTEMPTS = 40;

/**
 * Reserve `count` addresses that nothing in the domain is using.
 *
 * Every candidate is checked against the Directory API before it is handed
 * back, so a name that belongs to a real person — or to an earlier workshop
 * that is still running — is never handed to an attendee. `taken` seeds the
 * search with addresses this run already owns, so growing a workshop cannot
 * hand out a duplicate.
 */
export async function allocateEmails(
  count: number,
  taken: Iterable<string> = [],
  /** Injectable so the allocation loop can be tested without the API. */
  exists: (email: string) => Promise<boolean> = accountExists,
): Promise<string[]> {
  const seen = new Set(taken);
  const allocated: string[] = [];

  for (let i = 0; i < count; i++) {
    let chosen: string | undefined;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // `bouncypenguin` first; once the plain combinations keep colliding,
      // fall back to `bouncypenguin-479` to open up the space again.
      const suffix =
        attempt < PLAIN_ATTEMPTS ? "" : `-${crypto.randomInt(2, 1000)}`;
      const candidate = usernameEmail(randomUsername() + suffix);

      if (seen.has(candidate)) continue;
      seen.add(candidate);
      if (await exists(candidate)) continue;

      chosen = candidate;
      break;
    }

    if (!chosen) {
      throw new Error(
        `could not find an unused username after ${MAX_ATTEMPTS} attempts ` +
          `(${COMBINATIONS} base combinations) — is the domain full of stale ` +
          `workshop accounts?`,
      );
    }
    allocated.push(chosen);
  }

  return allocated;
}
