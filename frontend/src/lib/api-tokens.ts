/** Personal access tokens: minting, listing and revoking them. */

import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  apiTokens,
  users,
  MAX_TOKENS_PER_USER,
} from "@/db/schema";
import type { Access } from "@/lib/roles";
import { isJudgingNow } from "@/lib/scheduler/judging";
import { isManagerNow } from "@/lib/evals/managers";

const TOKEN_PREFIX = "wo";

const PREFIX_BYTES = 8;
const SECRET_BYTES = 32;

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

/** `bundle` tokens came with the contributor bundle download, now removed; old ones run out. */
export type TokenSource = "manual" | "bundle";

export type MintedToken = {
  id: string;
  name: string;
  prefix: string;
  expiresAt: null;
  token: string;
};

export type TokenError = "too_many" | "invalid_name";

export async function mintToken(
  userId: string,
  name: string,
): Promise<{ ok: true; token: MintedToken } | { ok: false; error: TokenError }> {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { ok: false, error: "invalid_name" };

  const live = await listTokens(userId);
  const manual = live.filter(
    (t) => t.status === "active" && t.source === "manual",
  );
  if (manual.length >= MAX_TOKENS_PER_USER) {
    return { ok: false, error: "too_many" };
  }

  const prefix = randomBytes(PREFIX_BYTES).toString("hex");
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const token = `${TOKEN_PREFIX}_${prefix}_${secret}`;

  const [row] = await db
    .insert(apiTokens)
    .values({
      userId,
      name: trimmed,
      prefix,
      tokenHash: sha256(token),
      source: "manual",
    })
    .returning({ id: apiTokens.id });

  return {
    ok: true,
    token: { id: row!.id, name: trimmed, prefix, expiresAt: null, token },
  };
}

export type TokenSummary = {
  id: string;
  name: string;
  source: TokenSource;
  prefix: string;
  status: "active" | "expired" | "revoked";
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
};

export async function listTokens(userId: string): Promise<TokenSummary[]> {
  const rows = await db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(asc(apiTokens.createdAt));

  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    source: r.source as TokenSource,
    prefix: r.prefix,
    status: r.revokedAt
      ? ("revoked" as const)
      : r.expiresAt && r.expiresAt.getTime() < now
        ? ("expired" as const)
        : ("active" as const),
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt?.toISOString() ?? null,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  }));
}

export async function revokeToken(
  userId: string,
  tokenId: string,
): Promise<boolean> {
  const revoked = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiTokens.id, tokenId),
        eq(apiTokens.userId, userId),
        isNull(apiTokens.revokedAt),
      ),
    )
    .returning({ id: apiTokens.id });

  return revoked.length > 0;
}

export type TokenBearer = { id: string; access: Access; email: string | null };

export async function resolveToken(
  presented: string,
): Promise<TokenBearer | null> {
  const match = new RegExp(`^${TOKEN_PREFIX}_([0-9a-f]{${PREFIX_BYTES * 2}})_(.+)$`).exec(
    presented,
  );
  if (!match) return null;
  const prefix = match[1]!;

  const [row] = await db
    .select({
      id: apiTokens.id,
      userId: apiTokens.userId,
      tokenHash: apiTokens.tokenHash,
      expiresAt: apiTokens.expiresAt,
      revokedAt: apiTokens.revokedAt,
      eventRole: users.eventRole,
      trainingRole: users.trainingRole,
      assessmentsRole: users.assessmentsRole,
      irisRole: users.irisRole,
      isPlatformAdmin: users.isPlatformAdmin,
      email: users.email,
    })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(eq(apiTokens.prefix, prefix));

  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt.getTime() < Date.now())) {
    return null;
  }

  const expected = Buffer.from(row.tokenHash, "hex");
  const actual = Buffer.from(sha256(presented), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  void db
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokens.id, row.id))
    .catch(() => {});

  return {
    id: row.userId,
    access: {
      event: row.eventRole,
      training: row.trainingRole,
      assessments: row.assessmentsRole,
      iris: row.irisRole,
      platform: row.isPlatformAdmin,
      judging: await isJudgingNow(row.email),
      manager: await isManagerNow(row.email),
    },
    email: row.email,
  };
}
