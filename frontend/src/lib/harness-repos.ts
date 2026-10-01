/**
 * The GitHub repositories every workshop's Harness account gets a copy of.
 *
 * An administrator lists them once here; each provision imports them with the
 * Harness Code importer — into the event's organization, or into every
 * attendee's own project, depending on the scope chosen per repository.
 */

import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { harnessRepos, REPO_SCOPES, users, type RepoScope } from "@/db/schema";
import {
  parseGithubUrl,
  repoIdentifierValid,
  suggestedIdentifier,
  type RepoRow,
} from "@/lib/github-repos";
import type { RepoSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";

export type RepoError =
  | "invalid_url"
  | "invalid_identifier"
  | "invalid_scope"
  | "duplicate"
  | "not_found";

export const STATUS_FOR: Record<RepoError, number> = {
  invalid_url: 400,
  invalid_identifier: 400,
  invalid_scope: 400,
  duplicate: 409,
  not_found: 404,
};

const isScope = (value: unknown): value is RepoScope =>
  typeof value === "string" && (REPO_SCOPES as readonly string[]).includes(value);

const REPO_SORT_COLUMNS = {
  identifier: sql`lower(${harnessRepos.identifier})`,
  providerRepo: sql`lower(${harnessRepos.providerRepo})`,
  scope: harnessRepos.scope,
  addedBy: sql`lower(coalesce(nullif(${users.name}, ''), ${users.email}))`,
} as const;

/** One page of the list; the search matches the address, either name, the level or who added it. */
export async function listRepos(query: ListQuery<RepoSort>): Promise<Page<RepoRow>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select({
      id: harnessRepos.id,
      url: harnessRepos.url,
      providerRepo: harnessRepos.providerRepo,
      identifier: harnessRepos.identifier,
      scope: harnessRepos.scope,
      createdAt: harnessRepos.createdAt,
      byName: users.name,
      byEmail: users.email,
    })
    .from(harnessRepos)
    .leftJoin(users, eq(users.id, harnessRepos.addedBy))
    .where(
      searchAny(query.q, [
        harnessRepos.url,
        harnessRepos.providerRepo,
        harnessRepos.identifier,
        harnessRepos.scope,
        users.name,
        users.email,
      ]),
    )
    .orderBy(...orderFor(REPO_SORT_COLUMNS[query.sort], query.dir, harnessRepos.identifier, harnessRepos.id))
    .limit(limit)
    .offset(offset);

  return toPage(rows.map((row) => ({
    id: row.id,
    url: row.url,
    providerRepo: row.providerRepo,
    identifier: row.identifier,
    scope: isScope(row.scope) ? row.scope : "org",
    createdAt: row.createdAt.toISOString(),
    addedBy: row.byName ?? row.byEmail ?? null,
  })), query.page);
}

/** Straight off the wire, so every field is suspect until `check` has had it. */
export type RepoInput = {
  url?: unknown;
  identifier?: unknown;
  scope?: unknown;
};

type Result = { ok: true } | { ok: false; error: RepoError };

type Checked = {
  url: string;
  providerRepo: string;
  identifier: string;
  scope: RepoScope;
};

function check(input: RepoInput): Checked | RepoError {
  if (typeof input.url !== "string") return "invalid_url";
  const github = parseGithubUrl(input.url);
  if (!github) return "invalid_url";

  // An empty name means "call it whatever GitHub calls it", which is what the
  // form pre-fills and so what an administrator who left it alone expects.
  const typed = typeof input.identifier === "string" ? input.identifier.trim() : "";
  const identifier = typed.length > 0 ? typed : suggestedIdentifier(github.providerRepo);
  if (!repoIdentifierValid(identifier)) return "invalid_identifier";

  if (!isScope(input.scope)) return "invalid_scope";

  return { ...github, identifier, scope: input.scope };
}

export async function addRepo(
  addedBy: string,
  input: RepoInput,
): Promise<Result> {
  const checked = check(input);
  if (typeof checked === "string") return { ok: false, error: checked };

  const clash = await db
    .select({ id: harnessRepos.id })
    .from(harnessRepos)
    .where(
      and(
        eq(harnessRepos.identifier, checked.identifier),
        eq(harnessRepos.scope, checked.scope),
      ),
    );
  if (clash.length > 0) return { ok: false, error: "duplicate" };

  await db.insert(harnessRepos).values({ ...checked, addedBy });
  return { ok: true };
}

export async function updateRepo(id: string, input: RepoInput): Promise<Result> {
  const checked = check(input);
  if (typeof checked === "string") return { ok: false, error: checked };

  const clash = await db
    .select({ id: harnessRepos.id })
    .from(harnessRepos)
    .where(
      and(
        eq(harnessRepos.identifier, checked.identifier),
        eq(harnessRepos.scope, checked.scope),
        ne(harnessRepos.id, id),
      ),
    );
  if (clash.length > 0) return { ok: false, error: "duplicate" };

  const updated = await db
    .update(harnessRepos)
    .set(checked)
    .where(eq(harnessRepos.id, id))
    .returning({ id: harnessRepos.id });
  return updated.length > 0 ? { ok: true } : { ok: false, error: "not_found" };
}

export async function deleteRepo(id: string): Promise<Result> {
  const deleted = await db
    .delete(harnessRepos)
    .where(eq(harnessRepos.id, id))
    .returning({ id: harnessRepos.id });
  return deleted.length > 0 ? { ok: true } : { ok: false, error: "not_found" };
}
