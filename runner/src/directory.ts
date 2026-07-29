import crypto from "node:crypto";
import { google, type admin_directory_v1 } from "googleapis";
import { workspaceCfg } from "./config.js";
import { COMBINATIONS, displayName, randomUsername } from "./usernames.js";

const SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.orgunit",
  "https://www.googleapis.com/auth/admin.directory.user",
];

/**
 * Admin SDK client. The runner's service account has domain-wide delegation
 * for the scopes above and impersonates a super-admin (`subject`), because the
 * Directory API refuses service-account identities acting as themselves.
 */
async function directory(): Promise<admin_directory_v1.Admin> {
  // Use googleapis' own auth export — the runner's direct google-auth-library
  // dependency is a different copy and its types are not interchangeable.
  const auth = new google.auth.GoogleAuth({
    scopes: SCOPES,
    clientOptions: { subject: workspaceCfg().adminEmail },
  });
  return google.admin({ version: "directory_v1", auth });
}

/** HTTP status of a googleapis error, if it carries one. */
function statusOf(err: unknown): number | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? Number((err as { code: unknown }).code)
    : undefined;
}

function joinOrgUnitPath(parent: string, name: string): string {
  const base = parent.endsWith("/") ? parent.slice(0, -1) : parent;
  return `${base}/${name}`;
}

/**
 * Create the workshop's organizational unit, named after the workshop.
 * Idempotent: an existing OU at the same path is reused so a retried run does
 * not fail. Returns the full org unit path.
 */
export async function createOrgUnit(name: string): Promise<string> {
  const svc = await directory();
  const { customerId, parentOrgUnitPath } = workspaceCfg();
  const path = joinOrgUnitPath(parentOrgUnitPath, name);

  try {
    const res = await svc.orgunits.insert({
      customerId,
      requestBody: { name, parentOrgUnitPath },
    });
    return res.data.orgUnitPath ?? path;
  } catch (err) {
    if (statusOf(err) !== 409) throw err;
    // Already exists — adopt it.
    const res = await svc.orgunits.get({
      customerId,
      orgUnitPath: path.replace(/^\//, ""),
    });
    return res.data.orgUnitPath ?? path;
  }
}

export async function deleteOrgUnit(orgUnitPath: string): Promise<void> {
  const svc = await directory();
  try {
    await svc.orgunits.delete({
      customerId: workspaceCfg().customerId,
      orgUnitPath: orgUnitPath.replace(/^\//, ""),
    });
  } catch (err) {
    if (statusOf(err) !== 404) throw err;
  }
}

/** A password that satisfies Workspace complexity rules. */
function generatePassword(): string {
  return crypto.randomBytes(12).toString("base64url").slice(0, 16) + "aA1!";
}

export type CreatedAccount = { email: string; tempPassword: string };

/**
 * Create one attendee account inside the workshop's OU. The display name is
 * derived from the generated username, so `bouncy-penguin@…` shows up as
 * "Bouncy Penguin".
 */
export async function createAccount(input: {
  email: string;
  orgUnitPath: string;
}): Promise<CreatedAccount> {
  const svc = await directory();
  const tempPassword = generatePassword();

  const body: admin_directory_v1.Schema$User = {
    primaryEmail: input.email,
    name: displayName(localPartOf(input.email)),
    password: tempPassword,
    changePasswordAtNextLogin: true,
    orgUnitPath: input.orgUnitPath,
  };

  try {
    await svc.users.insert({ requestBody: body });
  } catch (err) {
    if (statusOf(err) !== 409) throw err;
    // Someone got this address between the availability check and here. If it
    // sits in this workshop's OU it is ours — an earlier attempt that crashed
    // before recording it — so adopt it. Anywhere else it belongs to a real
    // person, and resetting their password would lock them out.
    const existing = await svc.users.get({ userKey: input.email });
    if (existing.data.orgUnitPath !== input.orgUnitPath) {
      throw new Error(
        `address ${input.email} is already in use outside ${input.orgUnitPath}`,
      );
    }
    await svc.users.update({ userKey: input.email, requestBody: body });
  }
  return { email: input.email, tempPassword };
}

export async function deleteAccount(email: string): Promise<void> {
  const svc = await directory();
  try {
    await svc.users.delete({ userKey: email });
  } catch (err) {
    if (statusOf(err) !== 404) throw err;
  }
}

function localPartOf(email: string): string {
  return email.split("@")[0] ?? email;
}

/** Address for a generated username, e.g. `bouncy-penguin@example.com`. */
export function usernameEmail(username: string): string {
  return `${username}@${workspaceCfg().domain}`;
}

/** Whether an address is already taken anywhere in the domain. */
export async function accountExists(email: string): Promise<boolean> {
  const svc = await directory();
  try {
    await svc.users.get({ userKey: email });
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
      // `bouncy-penguin` first; once the plain combinations keep colliding,
      // fall back to `bouncy-penguin-479` to open up the space again.
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
