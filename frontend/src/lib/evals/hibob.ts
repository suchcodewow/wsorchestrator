/**
 * The HiBob connection eVals imports employees with, and the import itself.
 *
 * The service user's token is sealed like a Harness token and never leaves
 * the server; the settings page sees its last four characters. An import asks
 * HiBob for every active employee and replaces `hibob_employees` with them in
 * one transaction, so a failed import leaves the previous one in place.
 */

import "server-only";

import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { HIBOB_LIMITS, hibobConnection, hibobEmployees, users } from "@/db/schema";
import { hibobAuthorization, toEmployeeRow } from "@/lib/evals/hibob-record";
import { openSecret, sealSecret } from "@/lib/secret-box";

const SEARCH_URL = "https://api.hibob.com/v1/people/search";
const ID = "site";

export type HibobError =
  | "invalid"
  | "not_configured"
  | "rejected"
  | "unreachable"
  | "bad_response"
  | "no_key"
  | "unreadable";

export const STATUS_FOR: Record<HibobError, number> = {
  invalid: 400,
  not_configured: 409,
  rejected: 422,
  unreachable: 502,
  bad_response: 502,
  no_key: 503,
  unreadable: 409,
};

export const connectionInputSchema = z.object({
  serviceUserId: z.string().trim().min(1).max(HIBOB_LIMITS.serviceUserId),
  token: z.string().trim().min(1).max(HIBOB_LIMITS.token),
});

export type HibobConnectionSummary = {
  serviceUserId: string;
  tail: string;
  updatedAt: Date;
  updatedBy: string | null;
  lastImportAt: Date | null;
  lastImportCount: number | null;
  lastImportError: string | null;
};

export async function getHibobConnection(): Promise<HibobConnectionSummary | null> {
  const [row] = await db
    .select({
      serviceUserId: hibobConnection.serviceUserId,
      tail: hibobConnection.tail,
      updatedAt: hibobConnection.updatedAt,
      updatedByName: users.name,
      updatedByEmail: users.email,
      lastImportAt: hibobConnection.lastImportAt,
      lastImportCount: hibobConnection.lastImportCount,
      lastImportError: hibobConnection.lastImportError,
    })
    .from(hibobConnection)
    .leftJoin(users, eq(users.id, hibobConnection.updatedBy))
    .where(eq(hibobConnection.id, ID));
  if (!row) return null;
  const { updatedByName, updatedByEmail, ...rest } = row;
  return { ...rest, updatedBy: updatedByName ?? updatedByEmail };
}

type Search = { fields?: string[] };

/** One `people/search` call; the employees, or why there are none. */
async function search(
  serviceUserId: string,
  token: string,
  body: Search,
): Promise<{ ok: true; employees: unknown[] } | { ok: false; error: HibobError; detail?: string }> {
  let res: Response;
  try {
    res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: hibobAuthorization(serviceUserId, token),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ showInactive: false, humanReadable: "APPEND", ...body }),
      signal: AbortSignal.timeout(120_000),
      cache: "no-store",
    });
  } catch (err) {
    // undici's own message is just "fetch failed"; the reason is its cause.
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : null;
    return {
      ok: false,
      error: "unreachable",
      detail: cause ?? (err instanceof Error ? err.message : undefined),
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: "rejected", detail: `HiBob answered ${res.status}` };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: "bad_response", detail: `HiBob answered ${res.status} ${text.slice(0, 200)}` };
  }

  const json = (await res.json().catch(() => null)) as { employees?: unknown } | null;
  if (!json || !Array.isArray(json.employees)) {
    return { ok: false, error: "bad_response", detail: "HiBob's answer had no employee list" };
  }
  return { ok: true, employees: json.employees };
}

/** Checks the credentials with a one-field search, then saves them sealed. */
export async function saveHibobConnection(
  actorId: string,
  input: z.infer<typeof connectionInputSchema>,
): Promise<{ ok: true } | { ok: false; error: HibobError; detail?: string }> {
  const check = await search(input.serviceUserId, input.token, { fields: ["/root/id"] });
  if (!check.ok) return check;

  let secret: Buffer;
  try {
    secret = sealSecret(input.token);
  } catch {
    return { ok: false, error: "no_key" };
  }

  const values = {
    serviceUserId: input.serviceUserId,
    secret,
    tail: input.token.slice(-4),
    updatedBy: actorId,
    updatedAt: new Date(),
  };
  await db
    .insert(hibobConnection)
    .values({ id: ID, ...values })
    .onConflictDoUpdate({ target: hibobConnection.id, set: values });
  return { ok: true };
}

/** Forgets the credentials. Imported employees stay until the next import. */
export async function deleteHibobConnection(): Promise<void> {
  await db.delete(hibobConnection).where(eq(hibobConnection.id, ID));
}

const BATCH = 500;

export type ImportResult =
  | { ok: true; count: number; skipped: number }
  | { ok: false; error: HibobError; detail?: string };

/** Replaces every stored employee with HiBob's current list. */
export async function importHibobEmployees(actorId: string): Promise<ImportResult> {
  const [conn] = await db.select().from(hibobConnection).where(eq(hibobConnection.id, ID));
  if (!conn) return { ok: false, error: "not_configured" };

  const token = openSecret(conn.secret);
  if (token === null) return { ok: false, error: "unreadable" };

  const result = await search(conn.serviceUserId, token, {});
  if (!result.ok) {
    await db
      .update(hibobConnection)
      .set({ lastImportError: result.detail ?? result.error })
      .where(eq(hibobConnection.id, ID));
    return result;
  }

  const rows = result.employees.map(toEmployeeRow).filter((r) => r !== null);
  // HiBob ids are unique, but a repeat would abort the whole insert.
  const unique = [...new Map(rows.map((r) => [r.id, r])).values()];
  const importedAt = new Date();

  await db.transaction(async (tx) => {
    // Two imports at once would otherwise interleave their delete and insert.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('hibob_employees'))`);
    await tx.delete(hibobEmployees);
    for (let i = 0; i < unique.length; i += BATCH) {
      await tx
        .insert(hibobEmployees)
        .values(unique.slice(i, i + BATCH).map((r) => ({ ...r, importedAt })));
    }
    await tx
      .update(hibobConnection)
      .set({
        lastImportAt: importedAt,
        lastImportCount: unique.length,
        lastImportBy: actorId,
        lastImportError: null,
      })
      .where(eq(hibobConnection.id, ID));
  });

  return { ok: true, count: unique.length, skipped: result.employees.length - unique.length };
}
