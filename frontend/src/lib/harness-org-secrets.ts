import "server-only";
import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  harnessOrgSecrets,
  ORG_SECRET_LIMITS,
  users,
  type HarnessOrgSecret,
  type OrgSecretKind,
} from "@/db/schema";
import { openSecret, sealSecret } from "@/lib/secret-box";

/**
 * Secrets an administrator wants in every workshop's Harness organization.
 *
 * Site-wide, not per user: the row is the deployment's, so nothing here is
 * scoped by whoever is asking — the route's `canManageSettings` check is the
 * whole gate. That is the difference from `@/lib/harness-tokens`, where the
 * user id is part of every statement because the rows are other people's.
 *
 * The value is sealed and comes back out again: the runner has to hand the real
 * thing to Harness when it builds an org. Nothing in the app ever shows it
 * again — the list carries a length, which is enough to tell "I pasted the key"
 * from "I pasted the filename".
 */

/** A saved secret as the settings page sees it — everything but the value. */
export type OrgSecretRow = {
  id: string;
  identifier: string;
  kind: OrgSecretKind;
  fileName: string | null;
  bytes: number;
  createdAt: string;
  updatedAt: string;
  /** Who last set the value, for the table. Null once that account is gone. */
  updatedBy: string | null;
  /**
   * Whether the stored value can still be decrypted. False means the encryption
   * key changed underneath it, so the row describes a secret no run can create
   * — and the only fix is entering the value again.
   */
  usable: boolean;
};

/**
 * Harness's rule for a secret identifier. Looser than for everything else on
 * the platform, which is worth stating rather than reusing the general one: a
 * hyphen is legal here and nowhere else, so `gcp-key` is a name somebody will
 * reasonably type and a shared validator would reject.
 */
const IDENTIFIER = /^[a-zA-Z_][0-9a-zA-Z_$-]{0,127}$/;

export const identifierValid = (value: string) => IDENTIFIER.test(value.trim());

export type OrgSecretError =
  /** Not a legal Harness secret identifier. */
  | "invalid_identifier"
  /** Another row already has that identifier. */
  | "duplicate"
  /** No value given, or a file with nothing in it. */
  | "empty"
  /** Over `ORG_SECRET_LIMITS.bytes`. */
  | "too_large"
  /** The upload is not UTF-8 text — see `readOrgSecretForm`. */
  | "binary"
  /** The request was not a form of either shape. */
  | "malformed"
  /** No encryption key configured, so nothing can be stored safely. */
  | "no_key"
  | "not_found";

export const STATUS_FOR: Record<OrgSecretError, number> = {
  invalid_identifier: 400,
  empty: 400,
  malformed: 400,
  duplicate: 409,
  too_large: 413,
  binary: 415,
  not_found: 404,
  // A deployment missing its encryption key. Nothing the administrator can fix
  // from this page, which is why it is not a 400.
  no_key: 503,
};

export type OrgSecretResult =
  | { ok: true; secret: OrgSecretRow }
  | { ok: false; error: OrgSecretError };

const summarize = (
  row: HarnessOrgSecret,
  updatedBy: string | null,
): OrgSecretRow => ({
  id: row.id,
  identifier: row.identifier,
  kind: row.kind as OrgSecretKind,
  fileName: row.fileName,
  bytes: row.bytes,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  updatedBy,
  // A few bytes of AES per row, and the alternative is a list that looks
  // healthy right up until a workshop fails to build.
  usable: openSecret(row.secret) !== null,
});

export async function listOrgSecrets(): Promise<OrgSecretRow[]> {
  const rows = await db
    .select({ secret: harnessOrgSecrets, byName: users.name, byEmail: users.email })
    .from(harnessOrgSecrets)
    .leftJoin(users, eq(users.id, harnessOrgSecrets.updatedBy))
    .orderBy(asc(harnessOrgSecrets.identifier));

  return rows.map((r) => summarize(r.secret, r.byName ?? r.byEmail ?? null));
}

/**
 * One saved secret with its plaintext, for code that has to hand the real thing
 * to Harness. `value` is null when the row was sealed with a different key than
 * this deployment now holds — a caller reports that per row rather than failing
 * the whole batch, because the fix is re-entering that one value.
 */
export type OrgSecretValue = {
  identifier: string;
  kind: OrgSecretKind;
  fileName: string | null;
  value: string | null;
};

/**
 * Every org secret, opened.
 *
 * The counterpart to `listOrgSecrets`, which deliberately never returns a value:
 * this is the only function here that does, and it exists because the values have
 * to reach Harness. Not reachable from any page — the deploy is its one caller —
 * and that separation is why the settings tab can be sure it cannot leak one.
 */
export async function orgSecretValues(): Promise<OrgSecretValue[]> {
  const rows = await db
    .select()
    .from(harnessOrgSecrets)
    .orderBy(asc(harnessOrgSecrets.identifier));

  return rows.map((row) => ({
    identifier: row.identifier,
    kind: row.kind as OrgSecretKind,
    fileName: row.fileName,
    value: openSecret(row.secret),
  }));
}

/** What a caller supplies for either a new secret or a new value. */
export type OrgSecretInput = {
  kind: OrgSecretKind;
  /** The plaintext. For a file, its contents. */
  value: string;
  /** What the upload was called. Ignored for an inline value. */
  fileName?: string | null;
};

/**
 * Read either shape of the add/update form.
 *
 * `multipart/form-data` for both rather than JSON for one and a form for the
 * other: a file arrives as bytes instead of a third larger as base64 text, and
 * one request shape means one parser and one set of error cases for what is the
 * same write either way.
 *
 * A file's contents are decoded strictly as UTF-8, and a strict decode is the
 * point. These end up as a Harness secret's text — a service account key, a PEM
 * chain, a kubeconfig — so a `.p12` or a zip has no shape to become, and a lax
 * decode would store a value full of replacement characters that fails much
 * later, inside a workshop, as a credential Harness holds but nothing can use.
 */
export type OrgSecretForm =
  | { ok: true; identifier: string; input: OrgSecretInput }
  | { ok: false; error: OrgSecretError };

export async function readOrgSecretForm(form: FormData): Promise<OrgSecretForm> {
  const identifier = String(form.get("identifier") ?? "");
  const kind = String(form.get("kind") ?? "");

  if (kind === "text") {
    const value = form.get("value");
    if (typeof value !== "string") return { ok: false, error: "malformed" };
    return { ok: true, identifier, input: { kind: "text", value } };
  }

  if (kind !== "file") return { ok: false, error: "malformed" };

  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, error: "malformed" };

  const bytes = await file.arrayBuffer();
  if (bytes.byteLength === 0) return { ok: false, error: "empty" };
  // Checked here as well as in `seal`, so an oversized upload is refused on the
  // bytes that arrived rather than on their length after decoding.
  if (bytes.byteLength > ORG_SECRET_LIMITS.bytes) {
    return { ok: false, error: "too_large" };
  }

  try {
    return {
      ok: true,
      identifier,
      input: {
        kind: "file",
        value: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        fileName: file.name,
      },
    };
  } catch {
    return { ok: false, error: "binary" };
  }
}

/**
 * The checks both writing paths share, in the order that answers most usefully:
 * shape first, then size, then the key. Returns the sealed blob, so a caller
 * that gets one has nothing left to validate.
 */
function seal(
  input: OrgSecretInput,
): { ok: true; secret: Buffer; bytes: number } | { ok: false; error: OrgSecretError } {
  const bytes = Buffer.byteLength(input.value, "utf8");
  if (bytes === 0) return { ok: false, error: "empty" };
  if (bytes > ORG_SECRET_LIMITS.bytes) return { ok: false, error: "too_large" };

  try {
    return { ok: true, secret: sealSecret(input.value), bytes };
  } catch {
    // Sealing can only fail for want of a key, which is a deployment fault
    // rather than anything the administrator did.
    return { ok: false, error: "no_key" };
  }
}

/** The file name to store: only meaningful for a file, and trimmed to fit. */
const fileNameFor = (input: OrgSecretInput) =>
  input.kind === "file" && input.fileName
    ? input.fileName.slice(0, ORG_SECRET_LIMITS.fileName)
    : null;

export async function createOrgSecret(
  identifier: string,
  input: OrgSecretInput,
  userId: string,
): Promise<OrgSecretResult> {
  const id = identifier.trim();
  if (!identifierValid(id)) return { ok: false, error: "invalid_identifier" };

  const sealed = seal(input);
  if (!sealed.ok) return sealed;

  // Checked rather than left to the unique index so the answer is "that name is
  // taken" instead of a 500 — and the index is still what makes it true under a
  // race.
  const [clash] = await db
    .select({ id: harnessOrgSecrets.id })
    .from(harnessOrgSecrets)
    .where(eq(harnessOrgSecrets.identifier, id));
  if (clash) return { ok: false, error: "duplicate" };

  const [row] = await db
    .insert(harnessOrgSecrets)
    .values({
      identifier: id,
      kind: input.kind,
      fileName: fileNameFor(input),
      bytes: sealed.bytes,
      secret: sealed.secret,
      updatedBy: userId,
    })
    .returning();

  return { ok: true, secret: summarize(row!, null) };
}

/**
 * Replace the value behind an existing secret, and with it the kind: a
 * credential that arrived as a pasted string this time and as a file last time
 * is the same secret to whoever is rotating it, and Harness will be told
 * whichever shape the row now says.
 *
 * The identifier can change too, since it is the only thing naming the row —
 * but the workshops already holding a secret under the old name are not
 * renamed. That is a truthful limit of a system that writes into orgs it does
 * not otherwise touch, and it is why the page says so rather than pretending.
 */
export async function updateOrgSecret(
  id: string,
  identifier: string,
  input: OrgSecretInput,
  userId: string,
): Promise<OrgSecretResult> {
  const name = identifier.trim();
  if (!identifierValid(name)) return { ok: false, error: "invalid_identifier" };

  const sealed = seal(input);
  if (!sealed.ok) return sealed;

  const [clash] = await db
    .select({ id: harnessOrgSecrets.id })
    .from(harnessOrgSecrets)
    .where(
      and(eq(harnessOrgSecrets.identifier, name), ne(harnessOrgSecrets.id, id)),
    );
  if (clash) return { ok: false, error: "duplicate" };

  const [row] = await db
    .update(harnessOrgSecrets)
    .set({
      identifier: name,
      kind: input.kind,
      fileName: fileNameFor(input),
      bytes: sealed.bytes,
      secret: sealed.secret,
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .where(eq(harnessOrgSecrets.id, id))
    .returning();

  if (!row) return { ok: false, error: "not_found" };
  return { ok: true, secret: summarize(row, null) };
}

/**
 * Forget a secret. Deleted outright, and only here: the copies already created
 * in live workshop orgs stay where they are until those orgs are torn down.
 * Reaching into them would mean deleting an org secret a running pipeline may
 * be mid-way through using.
 */
export async function deleteOrgSecret(id: string): Promise<boolean> {
  const deleted = await db
    .delete(harnessOrgSecrets)
    .where(eq(harnessOrgSecrets.id, id))
    .returning({ id: harnessOrgSecrets.id });
  return deleted.length > 0;
}
