/** A user's saved Harness tokens: checking, storing and removing them. */

import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  harnessTokens,
  MAX_HARNESS_TOKENS_PER_USER,
  type HarnessPermissionCheck,
  type HarnessToken,
} from "@/db/schema";
import {
  checkHarnessToken,
  fingerprint,
  harnessOrgUrl,
  type CheckError,
} from "@/lib/harness-platform";
import {
  EMPTY_SCRUB,
  scrubSummaries,
  scrubWithToken,
  type ScrubRun,
  type ScrubSummary,
} from "@/lib/harness-scrub";
import { openSecret, sealSecret } from "@/lib/secret-box";

export type HarnessDeploy = {
  orgName: string;
  orgIdentifier: string;
  orgUrl: string;
  at: string;
};

export type HarnessTokenSummary = {
  id: string;
  kind: string;
  accountId: string;
  accountName: string | null;
  principal: string | null;
  principalType: string | null;
  tail: string;
  permissions: HarnessPermissionCheck[];
  verifiedAt: string | null;
  createdAt: string;
  usable: boolean;
  lastDeploy: HarnessDeploy | null;
  scrub: ScrubSummary;
};

const lastDeployOf = (row: HarnessToken): HarnessDeploy | null =>
  row.deployedOrgName !== null &&
  row.deployedOrgIdentifier !== null &&
  row.deployedAt !== null
    ? {
        orgName: row.deployedOrgName,
        orgIdentifier: row.deployedOrgIdentifier,
        orgUrl: harnessOrgUrl(row.accountId, row.deployedOrgIdentifier),
        at: row.deployedAt.toISOString(),
      }
    : null;

const summarize = (
  row: HarnessToken,
  scrub: ScrubSummary = EMPTY_SCRUB,
): HarnessTokenSummary => ({
  id: row.id,
  kind: row.kind,
  accountId: row.accountId,
  accountName: row.accountName,
  principal: row.principal,
  principalType: row.principalType,
  tail: row.tail,
  permissions: row.permissions,
  verifiedAt: row.verifiedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  usable: openSecret(row.secret) !== null,
  lastDeploy: lastDeployOf(row),
  scrub,
});

export async function listHarnessTokens(
  userId: string,
): Promise<HarnessTokenSummary[]> {
  const rows = await db
    .select()
    .from(harnessTokens)
    .where(eq(harnessTokens.userId, userId))
    .orderBy(asc(harnessTokens.createdAt));

  const scrub = await scrubSummaries(rows.map((row) => row.id));
  return rows.map((row) => summarize(row, scrub.get(row.id)));
}

export type SaveError =
  | CheckError
  | "too_many"
  | "duplicate"
  | "no_key";

export type SaveResult =
  | { ok: true; token: HarnessTokenSummary }
  | { ok: false; error: SaveError; detail?: string };

export async function saveHarnessToken(
  userId: string,
  token: string,
): Promise<SaveResult> {
  const raw = token.trim();
  if (raw.length === 0) return { ok: false, error: "malformed" };

  const existing = await db
    .select({ id: harnessTokens.id, fingerprint: harnessTokens.fingerprint })
    .from(harnessTokens)
    .where(eq(harnessTokens.userId, userId));

  const print = fingerprint(raw);
  if (existing.some((row) => row.fingerprint === print)) {
    return { ok: false, error: "duplicate" };
  }
  if (existing.length >= MAX_HARNESS_TOKENS_PER_USER) {
    return { ok: false, error: "too_many" };
  }

  const check = await checkHarnessToken(raw);
  if (!check.ok) return { ok: false, error: check.error, detail: check.detail };

  let secret: Buffer;
  try {
    secret = sealSecret(raw);
  } catch {
    return { ok: false, error: "no_key" };
  }

  const [row] = await db
    .insert(harnessTokens)
    .values({
      userId,
      kind: check.token.kind,
      accountId: check.token.accountId,
      accountName: check.accountName,
      principal: check.principal,
      principalType: check.principalType,
      tail: check.token.tail,
      fingerprint: print,
      secret,
      permissions: check.permissions,
      verifiedAt: new Date(),
    })
    .returning();

  return { ok: true, token: summarize(row!) };
}

export type RecheckResult =
  | { ok: true; token: HarnessTokenSummary }
  | { ok: false; error: SaveError | "not_found" | "unreadable"; detail?: string };

export async function recheckHarnessToken(
  userId: string,
  id: string,
): Promise<RecheckResult> {
  const [row] = await db
    .select()
    .from(harnessTokens)
    .where(and(eq(harnessTokens.id, id), eq(harnessTokens.userId, userId)));
  if (!row) return { ok: false, error: "not_found" };

  const raw = openSecret(row.secret);
  if (raw === null) return { ok: false, error: "unreadable" };

  const check = await checkHarnessToken(raw);
  if (!check.ok) {
    await db
      .update(harnessTokens)
      .set({ verifiedAt: null })
      .where(eq(harnessTokens.id, row.id));
    return { ok: false, error: check.error, detail: check.detail };
  }

  const [updated] = await db
    .update(harnessTokens)
    .set({
      accountName: check.accountName ?? row.accountName,
      principal: check.principal,
      principalType: check.principalType,
      permissions: check.permissions,
      verifiedAt: new Date(),
    })
    .where(eq(harnessTokens.id, row.id))
    .returning();

  return { ok: true, token: summarize(updated!) };
}

export type DeleteResult = {
  deleted: boolean;
  scrub: ScrubRun | null;
};

export async function deleteHarnessToken(
  userId: string,
  id: string,
): Promise<DeleteResult> {
  const [row] = await db
    .select({ id: harnessTokens.id, secret: harnessTokens.secret })
    .from(harnessTokens)
    .where(and(eq(harnessTokens.id, id), eq(harnessTokens.userId, userId)));
  if (!row) return { deleted: false, scrub: null };

  const raw = openSecret(row.secret);
  let scrub: ScrubRun | null = null;
  if (raw !== null) {
    scrub = await scrubWithToken(id, raw).catch(() => null);
  }

  const deleted = await db
    .delete(harnessTokens)
    .where(and(eq(harnessTokens.id, id), eq(harnessTokens.userId, userId)))
    .returning({ id: harnessTokens.id });
  return { deleted: deleted.length > 0, scrub };
}

export async function recordHarnessDeploy(
  userId: string,
  id: string,
  org: { name: string; identifier: string },
): Promise<void> {
  await db
    .update(harnessTokens)
    .set({
      deployedOrgName: org.name,
      deployedOrgIdentifier: org.identifier,
      deployedAt: new Date(),
    })
    .where(and(eq(harnessTokens.id, id), eq(harnessTokens.userId, userId)));
}

export async function harnessTokenSecret(
  userId: string,
  id: string,
): Promise<string | null> {
  const [row] = await db
    .select({ secret: harnessTokens.secret })
    .from(harnessTokens)
    .where(and(eq(harnessTokens.id, id), eq(harnessTokens.userId, userId)));
  return row ? openSecret(row.secret) : null;
}
