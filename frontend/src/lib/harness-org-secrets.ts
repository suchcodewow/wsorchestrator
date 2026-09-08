/**
 * The secrets a workshop's Harness organization is given: the site's own, plus
 * whatever the user who deploys keeps of their own.
 */

import "server-only";
import { and, asc, eq, isNull, ne, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  harnessOrgSecrets,
  ORG_SECRET_LIMITS,
  users,
  type HarnessOrgSecret,
  type OrgSecretKind,
} from "@/db/schema";
import { openSecret, sealSecret } from "@/lib/secret-box";

/** A user's id for their own secrets, or null for the site's. */
export type SecretOwner = string | null;

const ownedBy = (owner: SecretOwner): SQL =>
  owner === null
    ? isNull(harnessOrgSecrets.userId)
    : eq(harnessOrgSecrets.userId, owner);

export type OrgSecretRow = {
  id: string;
  identifier: string;
  kind: OrgSecretKind;
  fileName: string | null;
  bytes: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  usable: boolean;
};

const IDENTIFIER = /^[a-zA-Z_][0-9a-zA-Z_$-]{0,127}$/;

export const identifierValid = (value: string) => IDENTIFIER.test(value.trim());

export type OrgSecretError =
  | "invalid_identifier"
  | "duplicate"
  | "empty"
  | "too_large"
  | "binary"
  | "malformed"
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
  usable: openSecret(row.secret) !== null,
});

export async function listOrgSecrets(
  owner: SecretOwner,
): Promise<OrgSecretRow[]> {
  const rows = await db
    .select({ secret: harnessOrgSecrets, byName: users.name, byEmail: users.email })
    .from(harnessOrgSecrets)
    .leftJoin(users, eq(users.id, harnessOrgSecrets.updatedBy))
    .where(ownedBy(owner))
    .orderBy(asc(harnessOrgSecrets.identifier));

  return rows.map((r) => summarize(r.secret, r.byName ?? r.byEmail ?? null));
}

export type OrgSecretValue = {
  identifier: string;
  kind: OrgSecretKind;
  fileName: string | null;
  value: string | null;
  /** True when it came from the deploying user rather than the site. */
  mine: boolean;
};

/**
 * What one user's deploy should write: the site's secrets, with the user's own
 * layered over them, so one of theirs named the same wins.
 */
export async function orgSecretValues(
  userId: string,
): Promise<OrgSecretValue[]> {
  const rows = await db
    .select()
    .from(harnessOrgSecrets)
    .where(
      or(isNull(harnessOrgSecrets.userId), eq(harnessOrgSecrets.userId, userId)),
    )
    .orderBy(asc(harnessOrgSecrets.identifier));

  const byIdentifier = new Map<string, OrgSecretValue>();
  for (const row of rows) {
    const mine = row.userId !== null;
    if (!mine && byIdentifier.has(row.identifier)) continue;

    byIdentifier.set(row.identifier, {
      identifier: row.identifier,
      kind: row.kind as OrgSecretKind,
      fileName: row.fileName,
      value: openSecret(row.secret),
      mine,
    });
  }

  return [...byIdentifier.values()];
}

export type OrgSecretInput = {
  kind: OrgSecretKind;
  value: string;
  fileName?: string | null;
};

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

function seal(
  input: OrgSecretInput,
): { ok: true; secret: Buffer; bytes: number } | { ok: false; error: OrgSecretError } {
  const bytes = Buffer.byteLength(input.value, "utf8");
  if (bytes === 0) return { ok: false, error: "empty" };
  if (bytes > ORG_SECRET_LIMITS.bytes) return { ok: false, error: "too_large" };

  try {
    return { ok: true, secret: sealSecret(input.value), bytes };
  } catch {
    return { ok: false, error: "no_key" };
  }
}

const fileNameFor = (input: OrgSecretInput) =>
  input.kind === "file" && input.fileName
    ? input.fileName.slice(0, ORG_SECRET_LIMITS.fileName)
    : null;

export async function createOrgSecret(
  owner: SecretOwner,
  identifier: string,
  input: OrgSecretInput,
  userId: string,
): Promise<OrgSecretResult> {
  const id = identifier.trim();
  if (!identifierValid(id)) return { ok: false, error: "invalid_identifier" };

  const sealed = seal(input);
  if (!sealed.ok) return sealed;

  const [clash] = await db
    .select({ id: harnessOrgSecrets.id })
    .from(harnessOrgSecrets)
    .where(and(ownedBy(owner), eq(harnessOrgSecrets.identifier, id)));
  if (clash) return { ok: false, error: "duplicate" };

  const [row] = await db
    .insert(harnessOrgSecrets)
    .values({
      userId: owner,
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

export async function updateOrgSecret(
  owner: SecretOwner,
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
      and(
        ownedBy(owner),
        eq(harnessOrgSecrets.identifier, name),
        ne(harnessOrgSecrets.id, id),
      ),
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
    .where(and(ownedBy(owner), eq(harnessOrgSecrets.id, id)))
    .returning();

  if (!row) return { ok: false, error: "not_found" };
  return { ok: true, secret: summarize(row, null) };
}

export async function deleteOrgSecret(
  owner: SecretOwner,
  id: string,
): Promise<boolean> {
  const deleted = await db
    .delete(harnessOrgSecrets)
    .where(and(ownedBy(owner), eq(harnessOrgSecrets.id, id)))
    .returning({ id: harnessOrgSecrets.id });
  return deleted.length > 0;
}
