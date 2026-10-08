/**
 * The audit trail: writing it, and reading it back a page at a time.
 *
 * Every non-GET route handler is exported as `audited(handler)`, which
 * records one row per request once the handler answers — who called (as
 * `requireCaller` found them), the route, the status, the request body with
 * secrets redacted, and whatever the handler added with `noteAudit`. A
 * request refused with 401 is not recorded: nobody was identified, so nobody
 * acted. Anything that acts outside a route — a sign-in, a server action, the
 * runner — calls `recordAudit` itself.
 *
 * Writing the trail never fails the action it records: an insert that errors
 * is logged and dropped.
 *
 * `test/unit/audit.test.ts` fails a route file that exports a non-GET
 * handler any other way.
 */

import "server-only";
import { desc, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  auditEvents,
  type AuditEvent,
  type AuditOutcome,
  type AuditVia,
} from "@/db/schema";
import { sessionOrToken } from "@/lib/api-auth";
import {
  auditScope,
  noteAudit,
  noteCaller,
  type AuditActor,
  type AuditScope,
} from "@/lib/audit-context";
import { createdTarget, endpointFor, outcomeFor, redact } from "@/lib/audit-shape";
import { IMPERSONATION_PATH } from "@/lib/impersonation";
import type { AuditSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { blankAsNull, orderFor, searchAny } from "@/lib/paging-sql";

export { noteAudit } from "@/lib/audit-context";

export type AuditEntry = {
  /** The account that acted; null for the app itself or someone with no account. */
  actor: AuditActor | null;
  /** Shown in place of an account when `actor` is null: one of SYSTEM_ACTORS, say. */
  actorName?: string;
  via: AuditVia;
  action: string;
  summary: string;
  path?: string | null;
  target?: string | null;
  targetLabel?: string | null;
  status?: number | null;
  outcome: AuditOutcome;
  detail?: Record<string, unknown> | null;
  ip?: string | null;
};

/** The names rows the app wrote on its own behalf are shown with. */
export const SYSTEM_ACTORS = {
  /** An internal route: Cloud Scheduler, or the production-import job. */
  system: "System",
  /** `runner/src/db.ts` writes this one; kept here so the two agree. */
  runner: "Runner",
} as const;

/**
 * Writes one row. The actor's name and email are copied in (looked up in the
 * same statement when the caller did not have them) so the row still says
 * who it was after the account is deleted.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  const actorId = entry.actor?.id ?? null;
  try {
    await db.insert(auditEvents).values({
      actorId,
      actorName:
        entry.actor?.name ??
        (actorId ? sql`(select name from users where id = ${actorId})` : entry.actorName ?? null),
      actorEmail:
        entry.actor?.email ??
        (actorId ? sql`(select email from users where id = ${actorId})` : null),
      via: entry.via,
      action: entry.action,
      summary: entry.summary,
      path: entry.path ?? null,
      target: entry.target ?? null,
      targetLabel: entry.targetLabel ?? null,
      status: entry.status ?? null,
      outcome: entry.outcome,
      detail: entry.detail ?? null,
      ip: entry.ip ?? null,
    });
  } catch (err) {
    console.error(`audit: could not record ${entry.action}`, err);
  }
}

/* ------------------------------------------------------------------ */
/* Recording a request                                                 */
/* ------------------------------------------------------------------ */

/** Past this, a body is described by its size rather than parsed. */
const MAX_BODY_BYTES = 1024 * 1024;

/** The request's body, redacted, read from a clone so the handler still gets it. */
async function requestBody(req: Request): Promise<unknown> {
  if (!req.body) return undefined;
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("multipart/form-data")) {
      const form = await req.clone().formData();
      const fields: Record<string, unknown> = {};
      for (const [name, v] of form) {
        fields[name] =
          typeof v === "string" ? v : { file: v.name, bytes: v.size, type: v.type };
      }
      return redact(fields);
    }
    const text = await req.clone().text();
    if (!text) return undefined;
    if (text.length > MAX_BODY_BYTES) return { bytes: text.length };
    try {
      return redact(JSON.parse(text));
    } catch {
      return { bytes: text.length };
    }
  } catch {
    return undefined;
  }
}

/** The client's address, as Cloud Run's front end passes it on. */
function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim() || null;
  return headers.get("x-real-ip");
}

/** The address of whoever made the current request, for a server action or an Auth.js event. */
export async function requestIp(): Promise<string | null> {
  try {
    return clientIp(await headers());
  } catch {
    return null;
  }
}

async function jsonOf(res: Response): Promise<Record<string, unknown> | null> {
  if (!(res.headers.get("content-type") ?? "").includes("application/json")) return null;
  try {
    const body = (await res.clone().json()) as unknown;
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

type RouteContext = { params?: Promise<Record<string, string | string[]>> } | undefined;

/**
 * A route handler that records itself in the audit trail. Wrap every
 * non-GET export: `export const POST = audited(async function POST(req) { … })`.
 */
export function audited<C extends RouteContext>(
  handler: (req: Request, ctx: C) => Promise<Response>,
): (req: Request, ctx: C) => Promise<Response> {
  return async (req, ctx) => {
    const scope: AuditScope = { note: {} };
    const body = await requestBody(req);

    let res: Response | null = null;
    let thrown: unknown = null;
    try {
      res = await auditScope.run(
        scope,
        async () => (await refuseWhileImpersonating(req)) ?? handler(req, ctx),
      );
    } catch (err) {
      thrown = err;
    }

    const status = res?.status ?? 500;
    if (status !== 401) {
      await auditScope.run(scope, () => writeRequest(req, ctx, scope, res, status, body));
    }

    if (thrown) throw thrown;
    return res!;
  };
}

/**
 * A 403 for any change asked of a session that is viewing the app as someone
 * else (`src/lib/impersonation.ts`), other than ending it. Session-only
 * routes call `auth()` themselves, so this asks too rather than trusting
 * `requireCaller` to.
 */
async function refuseWhileImpersonating(req: Request): Promise<Response | null> {
  if (new URL(req.url).pathname === IMPERSONATION_PATH) return null;

  const session = await auth();
  if (!session?.impersonator) return null;

  noteCaller(session.impersonator, "session");
  noteAudit({ detail: { impersonating: session.user.email ?? null } });
  return NextResponse.json({ error: "impersonating" }, { status: 403 });
}

async function writeRequest(
  req: Request,
  ctx: RouteContext,
  scope: AuditScope,
  res: Response | null,
  status: number,
  body: unknown,
): Promise<void> {
  const url = new URL(req.url);
  const endpoint = endpointFor(req.method, url.pathname);
  const internal = endpoint?.access === "internal";

  // A session-only route calls auth() itself, so requireCaller never saw who
  // it was; ask now. Internal routes are the scheduler or the runner.
  if (!scope.actor && !internal) await sessionOrToken(req);

  const params = ((await ctx?.params?.catch(() => undefined)) ?? {}) as Record<string, unknown>;
  const response = res ? await jsonOf(res) : null;

  let target = scope.note.target ?? (typeof params.id === "string" ? params.id : undefined);
  let targetLabel = scope.note.targetLabel;
  if (!target && status < 300 && response) {
    const made = createdTarget(response);
    target = made.target;
    targetLabel ??= made.targetLabel;
  }

  const detail: Record<string, unknown> = { ...scope.note.detail };
  if (body !== undefined) detail.body = body;
  if (status >= 400 && typeof response?.error === "string") detail.error = response.error;

  await recordAudit({
    actor: scope.actor ?? null,
    actorName: internal ? SYSTEM_ACTORS.system : undefined,
    via: scope.via ?? (internal ? "system" : "anonymous"),
    action: endpoint ? `${endpoint.method} ${endpoint.path}` : `${req.method} ${url.pathname}`,
    summary: endpoint?.summary ?? `${req.method} ${url.pathname}`,
    path: url.pathname,
    target: target ?? null,
    targetLabel: targetLabel ?? null,
    status,
    outcome: outcomeFor(status),
    detail: Object.keys(detail).length ? detail : null,
    ip: clientIp(req.headers),
  });
}

/* ------------------------------------------------------------------ */
/* Reading it back                                                     */
/* ------------------------------------------------------------------ */

export type AuditListing = Omit<AuditEvent, "at"> & { at: string };

const SORT_COLUMNS = {
  at: auditEvents.at,
  actor: sql`coalesce(nullif(${auditEvents.actorName}, ''), ${auditEvents.actorEmail})`,
  action: auditEvents.action,
  target: sql`coalesce(nullif(${auditEvents.targetLabel}, ''), ${blankAsNull(auditEvents.target)})`,
  outcome: auditEvents.outcome,
} as const;

/**
 * One page of the trail, newest first unless asked otherwise. The search
 * matches any part of who, what, where, the outcome and the recorded detail.
 */
export async function listAuditEvents(
  query: ListQuery<AuditSort>,
): Promise<Page<AuditListing>> {
  const where = searchAny(query.q, [
    auditEvents.actorName,
    auditEvents.actorEmail,
    auditEvents.action,
    auditEvents.summary,
    auditEvents.path,
    auditEvents.target,
    auditEvents.targetLabel,
    auditEvents.ip,
    sql`${auditEvents.via}::text`,
    sql`${auditEvents.outcome}::text`,
    sql`${auditEvents.detail}::text`,
  ]);
  const { limit, offset } = pageWindow(query.page);

  const rows = await db
    .select()
    .from(auditEvents)
    .where(where)
    .orderBy(...orderFor(SORT_COLUMNS[query.sort], query.dir, desc(auditEvents.at), auditEvents.id))
    .limit(limit)
    .offset(offset);

  return toPage(
    rows.map((r) => ({ ...r, at: r.at.toISOString() })),
    query.page,
  );
}
