import crypto from "node:crypto";
import { google, type admin_directory_v1 } from "googleapis";
import { workspaceCfg } from "./config.js";
import { COMBINATIONS, displayName, randomUsername } from "./usernames.js";

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
    // `unauthorized_client` means the Workspace Admin console has not granted
    // this service account's client ID the scopes above. That is the half of
    // the setup that lives outside GCP, and no amount of IAM substitutes for
    // it — so name it rather than letting a bare 401 stand.
    throw new Error(
      `Workspace delegation to ${adminEmail} was refused ` +
        `(${body.error ?? res.status}${
          body.error_description ? `: ${body.error_description}` : ""
        }). Check that ${signer}'s client ID is authorized for ` +
        `${SCOPES.join(", ")} in Admin console -> Security -> API controls -> ` +
        `Domain-wide delegation.`,
    );
  }

  delegated = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
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
  const key = path.replace(/^\//, "");

  try {
    const res = await svc.orgunits.insert({
      customerId,
      requestBody: { name, parentOrgUnitPath },
    });
    return res.data.orgUnitPath ?? path;
  } catch (err) {
    // The OU may already exist — a grown or retried workshop re-runs this. The
    // Directory API is not consistent about how it reports that: a 409 on some
    // paths, a 400 "Invalid Ou Id" on others (which is what breaks a grow of a
    // ready workshop). So don't trust the status — look. If the OU is there,
    // adopt it; only if it genuinely is not do we surface the insert error.
    try {
      const existing = await svc.orgunits.get({ customerId, orgUnitPath: key });
      if (existing.data.orgUnitPath) return existing.data.orgUnitPath;
    } catch (getErr) {
      if (statusOf(getErr) !== 404) throw getErr;
    }
    throw err;
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
 * derived from the generated username, so `bouncypenguin@…` shows up as
 * "Bouncypenguin".
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

/** Address for a generated username, e.g. `bouncypenguin@example.com`. */
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
