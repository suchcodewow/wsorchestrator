import crypto from "node:crypto";
import { google, type admin_directory_v1 } from "googleapis";
import { workspaceCfg } from "./config.js";

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
 * Create one attendee account inside the workshop's OU. Idempotent: if the
 * address already exists it is reused, with a freshly set password.
 */
export async function createAccount(input: {
  email: string;
  givenName: string;
  familyName: string;
  orgUnitPath: string;
}): Promise<CreatedAccount> {
  const svc = await directory();
  const tempPassword = generatePassword();

  const body: admin_directory_v1.Schema$User = {
    primaryEmail: input.email,
    name: { givenName: input.givenName, familyName: input.familyName },
    password: tempPassword,
    changePasswordAtNextLogin: true,
    orgUnitPath: input.orgUnitPath,
  };

  try {
    await svc.users.insert({ requestBody: body });
  } catch (err) {
    if (statusOf(err) !== 409) throw err;
    // Already exists — move it into this OU and reset the password.
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

/** Attendee address for user `n` (1-based) of a workshop. */
export function accountEmail(slug: string, n: number): string {
  const local = `${slug}-${String(n).padStart(2, "0")}`.slice(0, 64);
  return `${local}@${workspaceCfg().domain}`;
}
