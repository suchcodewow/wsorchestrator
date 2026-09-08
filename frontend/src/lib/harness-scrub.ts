/** Takes this site's secret values back out of Harness once the window is up. */

import "server-only";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  harnessDeployedSecrets,
  harnessTokens,
  type HarnessDeployedSecret,
  type ScrubStatus,
} from "@/db/schema";
import { harnessBaseUrl } from "@/lib/harness-platform";
import { openSecret } from "@/lib/secret-box";

export const SCRUB_VALUE = "123";

const SCRUB_TAGS = { deployed_by: "workshop-orchestrator", placeholder: "true" };

const DEFAULT_SCRUB_DAYS = 7;

export function scrubWindowDays(): number {
  const raw = process.env.HARNESS_CONTENT_SCRUB_DAYS;
  if (raw === undefined || raw.trim().length === 0) return DEFAULT_SCRUB_DAYS;
  const days = Number(raw);
  return Number.isFinite(days) && days >= 0 ? days : DEFAULT_SCRUB_DAYS;
}

export function scrubDeadline(from: Date = new Date()): Date {
  return new Date(from.getTime() + scrubWindowDays() * 86_400_000);
}

const scrubDescription = () =>
  `Value scrubbed by Workshop Orchestrator on ${new Date().toISOString().slice(0, 10)}. ` +
  `It held a real credential for the first ${scrubWindowDays()} day(s) after this ` +
  `content was deployed and now holds ${SCRUB_VALUE} — put the right value in ` +
  `before anything uses it.`;

export type DeployedSecret = {
  tokenId: string;
  accountId: string;
  orgIdentifier: string;
  secretIdentifier: string;
  kind: string;
  harnessUpdatedAt: Date | null;
};

export async function recordDeployedSecret(
  secret: DeployedSecret,
): Promise<void> {
  const now = new Date();
  await db
    .insert(harnessDeployedSecrets)
    .values({
      tokenId: secret.tokenId,
      accountId: secret.accountId,
      orgIdentifier: secret.orgIdentifier,
      secretIdentifier: secret.secretIdentifier,
      kind: secret.kind,
      harnessUpdatedAt: secret.harnessUpdatedAt,
      writtenAt: now,
      scrubAfter: scrubDeadline(now),
      status: "pending",
    })
    .onConflictDoUpdate({
      target: [
        harnessDeployedSecrets.accountId,
        harnessDeployedSecrets.orgIdentifier,
        harnessDeployedSecrets.secretIdentifier,
      ],
      set: {
        tokenId: secret.tokenId,
        kind: secret.kind,
        harnessUpdatedAt: secret.harnessUpdatedAt,
        writtenAt: now,
        scrubAfter: scrubDeadline(now),
        status: "pending",
        checkedAt: null,
        note: null,
      },
    });
}

export const harnessTimestamp = (value: unknown): Date | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? new Date(value)
    : null;

export type ScrubSummary = {
  pending: number;
  scrubbed: number;
  skipped: number;
  failed: number;
  dueAt: string | null;
  scrubbedAt: string | null;
  orgs: string[];
  problems: {
    secretIdentifier: string;
    orgIdentifier: string;
    status: ScrubStatus;
    note: string | null;
  }[];
};

export const EMPTY_SCRUB: ScrubSummary = {
  pending: 0,
  scrubbed: 0,
  skipped: 0,
  failed: 0,
  dueAt: null,
  scrubbedAt: null,
  orgs: [],
  problems: [],
};

export async function scrubSummaries(
  tokenIds: string[],
): Promise<Map<string, ScrubSummary>> {
  const summaries = new Map<string, ScrubSummary>();
  if (tokenIds.length === 0) return summaries;

  const rows = await db
    .select()
    .from(harnessDeployedSecrets)
    .where(inArray(harnessDeployedSecrets.tokenId, tokenIds))
    .orderBy(asc(harnessDeployedSecrets.secretIdentifier));

  for (const row of rows) {
    if (row.tokenId === null) continue;
    const summary =
      summaries.get(row.tokenId) ?? { ...EMPTY_SCRUB, orgs: [], problems: [] };

    if (!summary.orgs.includes(row.orgIdentifier)) {
      summary.orgs.push(row.orgIdentifier);
    }

    const status = row.status as ScrubStatus;
    if (status === "pending") {
      summary.pending += 1;
      const due = row.scrubAfter.toISOString();
      if (summary.dueAt === null || due < summary.dueAt) summary.dueAt = due;
    } else if (status === "scrubbed") {
      summary.scrubbed += 1;
      const at = (row.checkedAt ?? row.writtenAt).toISOString();
      if (summary.scrubbedAt === null || at > summary.scrubbedAt) {
        summary.scrubbedAt = at;
      }
    } else {
      summary[status] += 1;
      summary.problems.push({
        secretIdentifier: row.secretIdentifier,
        orgIdentifier: row.orgIdentifier,
        status,
        note: row.note,
      });
    }

    summaries.set(row.tokenId, summary);
  }

  return summaries;
}

const TIMEOUT_MS = 20_000;

type Reply = { status: number; text: string };

async function request(
  token: string,
  method: "GET" | "PUT",
  path: string,
  query: Record<string, string>,
  body?: unknown,
): Promise<Reply> {
  const url = `${harnessBaseUrl()}${path}?${new URLSearchParams(query)}`;
  const multipart = body instanceof FormData;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        "x-api-key": token,
        ...(body !== undefined && !multipart
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body:
        body === undefined
          ? undefined
          : multipart
            ? body
            : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    return { status: res.status, text: await res.text() };
  } catch (err) {
    return {
      status: 0,
      text: err instanceof Error ? err.message : "Could not reach Harness.",
    };
  }
}

const ok = (reply: Reply) => reply.status >= 200 && reply.status < 300;

function messageOf(text: string): string {
  try {
    return (JSON.parse(text) as { message?: string }).message ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

const GONE = /identifier \[[^\]]*\] (?:is )?not found/i;

type Metadata = {
  updatedAt: Date | null;
  name: string | null;
  secretManager: string | null;
};

function metadataOf(text: string): Metadata {
  try {
    const data = (
      JSON.parse(text) as {
        data?: {
          updatedAt?: unknown;
          secret?: { name?: unknown; spec?: { secretManagerIdentifier?: unknown } };
        };
      }
    ).data;
    const name = data?.secret?.name;
    const manager = data?.secret?.spec?.secretManagerIdentifier;
    return {
      updatedAt: harnessTimestamp(data?.updatedAt),
      name: typeof name === "string" && name.length > 0 ? name : null,
      secretManager: typeof manager === "string" && manager.length > 0 ? manager : null,
    };
  } catch {
    return { updatedAt: null, name: null, secretManager: null };
  }
}

const SKEW_MS = 5 * 60_000;

function modifiedSince(row: HarnessDeployedSecret, live: Date | null): boolean {
  if (live === null) return false;
  if (row.harnessUpdatedAt !== null) {
    return live.getTime() !== row.harnessUpdatedAt.getTime();
  }
  return live.getTime() > row.writtenAt.getTime() + SKEW_MS;
}

export type ScrubVerdict = { status: ScrubStatus; note: string | null };

export async function scrubSecret(
  row: HarnessDeployedSecret,
  token: string,
): Promise<ScrubVerdict> {
  const query = {
    accountIdentifier: row.accountId,
    orgIdentifier: row.orgIdentifier,
  };
  const id = encodeURIComponent(row.secretIdentifier);

  const current = await request(token, "GET", `/ng/api/v2/secrets/${id}`, query);
  if (!ok(current)) {
    const message = messageOf(current.text);
    if (GONE.test(message)) {
      return {
        status: "scrubbed",
        note: "Already gone from Harness — nothing left to scrub.",
      };
    }
    if (current.status === 401 || current.status === 403) {
      return {
        status: "failed",
        note:
          "The token that deployed this can no longer read it in Harness, so " +
          `remove the value by hand: ${message}`,
      };
    }
    return {
      status: "failed",
      note:
        current.status === 0
          ? `Could not reach Harness: ${current.text}`
          : `Harness would not report on it: ${message} (HTTP ${current.status})`,
    };
  }

  const live = metadataOf(current.text);
  if (modifiedSince(row, live.updatedAt)) {
    return {
      status: "skipped",
      note:
        "Somebody changed this secret in Harness after it was deployed, so the " +
        "value there is theirs now and has been left alone.",
    };
  }

  const name = live.name ?? row.secretIdentifier;
  const secretManager = live.secretManager ?? "org.harnessSecretManager";
  const description = scrubDescription();

  let reply: Reply;
  if (row.kind === "file") {
    const form = new FormData();
    form.append(
      "spec",
      JSON.stringify({
        secret: {
          type: "SecretFile",
          name,
          identifier: row.secretIdentifier,
          orgIdentifier: row.orgIdentifier,
          description,
          tags: SCRUB_TAGS,
          spec: { secretManagerIdentifier: secretManager },
        },
      }),
    );
    form.append(
      "file",
      new Blob([SCRUB_VALUE], { type: "text/plain" }),
      `${row.secretIdentifier}.txt`,
    );
    reply = await request(
      token,
      "PUT",
      `/ng/api/v2/secrets/files/${id}`,
      query,
      form,
    );
  } else {
    reply = await request(token, "PUT", `/ng/api/v2/secrets/${id}`, query, {
      secret: {
        type: "SecretText",
        name,
        identifier: row.secretIdentifier,
        orgIdentifier: row.orgIdentifier,
        description,
        tags: SCRUB_TAGS,
        spec: {
          secretManagerIdentifier: secretManager,
          valueType: "Inline",
          value: SCRUB_VALUE,
        },
      },
    });
  }

  if (ok(reply)) return { status: "scrubbed", note: null };

  const message = messageOf(reply.text);
  if (GONE.test(message)) {
    return {
      status: "scrubbed",
      note: "Already gone from Harness — nothing left to scrub.",
    };
  }
  return {
    status: "failed",
    note:
      reply.status === 0
        ? `Could not reach Harness: ${reply.text}`
        : `Harness refused the overwrite: ${message} (HTTP ${reply.status})`,
  };
}

async function record(id: string, verdict: ScrubVerdict): Promise<void> {
  await db
    .update(harnessDeployedSecrets)
    .set({ status: verdict.status, note: verdict.note, checkedAt: new Date() })
    .where(eq(harnessDeployedSecrets.id, id));
}

export type ScrubRun = {
  scrubbed: number;
  skipped: number;
  failed: number;
  problems: { secretIdentifier: string; status: ScrubStatus; note: string | null }[];
};

const EMPTY_RUN: ScrubRun = { scrubbed: 0, skipped: 0, failed: 0, problems: [] };

export async function scrubDeployedSecrets(
  userId: string,
  tokenId: string,
): Promise<ScrubRun | { error: "not_found" | "unreadable" }> {
  const [token] = await db
    .select({ id: harnessTokens.id, secret: harnessTokens.secret })
    .from(harnessTokens)
    .where(and(eq(harnessTokens.id, tokenId), eq(harnessTokens.userId, userId)));
  if (!token) return { error: "not_found" };

  const raw = openSecret(token.secret);
  if (raw === null) return { error: "unreadable" };

  return scrubWithToken(tokenId, raw);
}

export async function scrubWithToken(
  tokenId: string,
  token: string,
): Promise<ScrubRun> {
  const rows = await db
    .select()
    .from(harnessDeployedSecrets)
    .where(
      and(
        eq(harnessDeployedSecrets.tokenId, tokenId),
        ne(harnessDeployedSecrets.status, "scrubbed"),
        ne(harnessDeployedSecrets.status, "skipped"),
      ),
    )
    .orderBy(asc(harnessDeployedSecrets.secretIdentifier));

  if (rows.length === 0) return { ...EMPTY_RUN };

  const run: ScrubRun = { ...EMPTY_RUN, problems: [] };
  for (const row of rows) {
    const verdict = await scrubSecret(row, token);
    await record(row.id, verdict);
    if (verdict.status === "scrubbed") run.scrubbed += 1;
    else if (verdict.status === "skipped") run.skipped += 1;
    else run.failed += 1;
    if (verdict.status !== "scrubbed") {
      run.problems.push({
        secretIdentifier: row.secretIdentifier,
        status: verdict.status,
        note: verdict.note,
      });
    }
  }
  return run;
}
