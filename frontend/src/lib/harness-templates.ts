/**
 * The Harness organizations templates may be read from: the site's own, plus
 * whatever the user who deploys keeps of their own.
 */

import "server-only";
import { and, asc, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  harnessTemplateSources,
  MAX_TEMPLATE_SOURCES,
  users,
  type HarnessTemplateSource,
} from "@/db/schema";
import {
  checkTemplateSource,
  fingerprint,
  harnessAccountName,
  parseHarnessToken,
} from "@/lib/harness-platform";
import type { TemplateSourceError } from "@/lib/harness-template-errors";
import { openSecret, sealSecret } from "@/lib/secret-box";

/** A user's id for their own sources, or null for the site's. */
export type SourceOwner = string | null;

const ownedBy = (owner: SourceOwner): SQL =>
  owner === null
    ? isNull(harnessTemplateSources.userId)
    : eq(harnessTemplateSources.userId, owner);

export type TemplateSourceRow = {
  id: string;
  accountId: string;
  accountName: string | null;
  orgIdentifier: string;
  orgName: string | null;
  projectIdentifier: string | null;
  projectName: string | null;
  tail: string;
  createdAt: string;
  addedBy: string | null;
  usable: boolean;
  /** True when it belongs to a user rather than the site. */
  mine: boolean;
};

export type SourceStatus = {
  tokenOk: boolean;
  orgOk: boolean;
  projectOk: boolean | null;
  ok: boolean;
  detail?: string;
};

const summarize = (
  row: HarnessTemplateSource,
  addedBy: string | null,
): TemplateSourceRow => ({
  id: row.id,
  accountId: row.accountId,
  accountName: row.accountName,
  orgIdentifier: row.orgIdentifier,
  orgName: row.orgName,
  projectIdentifier: row.projectIdentifier === "" ? null : row.projectIdentifier,
  projectName: row.projectName,
  tail: row.tail,
  createdAt: row.createdAt.toISOString(),
  addedBy,
  usable: openSecret(row.secret) !== null,
  mine: row.userId !== null,
});

export async function listTemplateSources(
  owner: SourceOwner,
): Promise<TemplateSourceRow[]> {
  return sourcesWhere(ownedBy(owner));
}

/** Which sources a deploy was asked to read from. */
export type SourceChoice = {
  /** All of the site's own sources. */
  official: boolean;
  /** The ids of the deploying user's own sources they picked. */
  mine: string[];
};

/**
 * What one user's deploy may read from: the site's sources and whichever of
 * their own they picked, each place named only once even if both point at it.
 */
export async function deployableTemplateSources(
  userId: string,
  choice: SourceChoice,
): Promise<TemplateSourceRow[]> {
  if (!choice.official && choice.mine.length === 0) return [];

  const rows = await sourcesWhere(
    or(
      isNull(harnessTemplateSources.userId),
      eq(harnessTemplateSources.userId, userId),
    )!,
  );

  const picked = new Set(choice.mine);
  const wanted = rows.filter((r) => (r.mine ? picked.has(r.id) : choice.official));

  // The user's own row wins where both scopes name the same place, since it is
  // the more specific of the two.
  const seen = new Set<string>();
  return [
    ...wanted.filter((r) => r.mine),
    ...wanted.filter((r) => !r.mine),
  ].filter((row) => {
    const place = `${row.accountId}/${row.orgIdentifier}/${row.projectIdentifier ?? ""}`;
    if (seen.has(place)) return false;
    seen.add(place);
    return true;
  });
}

async function sourcesWhere(where: SQL): Promise<TemplateSourceRow[]> {
  const rows = await db
    .select({ source: harnessTemplateSources, byName: users.name, byEmail: users.email })
    .from(harnessTemplateSources)
    .leftJoin(users, eq(users.id, harnessTemplateSources.addedBy))
    .where(where)
    .orderBy(
      asc(harnessTemplateSources.orgIdentifier),
      asc(harnessTemplateSources.projectIdentifier),
    );

  return rows.map((r) => summarize(r.source, r.byName ?? r.byEmail ?? null));
}

export async function checkTemplateSources(
  rows: TemplateSourceRow[],
): Promise<Record<string, SourceStatus>> {
  if (rows.length === 0) return {};

  const secrets = await db
    .select({ id: harnessTemplateSources.id, secret: harnessTemplateSources.secret })
    .from(harnessTemplateSources)
    .where(inArray(harnessTemplateSources.id, rows.map((r) => r.id)));
  const tokenFor = new Map(secrets.map((r) => [r.id, openSecret(r.secret)]));

  const checked = await Promise.all(
    rows.map(async (row): Promise<[string, SourceStatus]> => {
      const token = tokenFor.get(row.id) ?? null;
      if (token === null) {
        return [
          row.id,
          {
            tokenOk: false,
            orgOk: false,
            projectOk: row.projectIdentifier ? false : null,
            ok: false,
            detail:
              "This token can no longer be decrypted — the deployment's encryption key changed.",
          },
        ];
      }

      const check = await checkTemplateSource(
        token,
        row.orgIdentifier,
        row.projectIdentifier,
      );
      return [
        row.id,
        {
          tokenOk: check.tokenOk,
          orgOk: check.orgOk,
          projectOk: check.projectOk,
          ok: check.tokenOk && check.orgOk && check.projectOk !== false,
          detail: check.detail,
        },
      ];
    }),
  );

  return Object.fromEntries(checked);
}

export type SaveResult =
  | { ok: true; source: TemplateSourceRow }
  | { ok: false; error: TemplateSourceError; detail?: string };

export async function saveTemplateSource(
  owner: SourceOwner,
  token: string,
  orgIdentifier: string,
  projectIdentifier: string | null,
  userId: string,
): Promise<SaveResult> {
  const raw = token.trim();
  const parsed = parseHarnessToken(raw);
  if (!parsed) return { ok: false, error: "malformed" };

  const org = orgIdentifier.trim();
  const project = (projectIdentifier ?? "").trim();
  if (org.length === 0) return { ok: false, error: "org_not_found" };

  const existing = await db
    .select({
      fingerprint: harnessTemplateSources.fingerprint,
      orgIdentifier: harnessTemplateSources.orgIdentifier,
      projectIdentifier: harnessTemplateSources.projectIdentifier,
    })
    .from(harnessTemplateSources)
    .where(ownedBy(owner));

  const print = fingerprint(raw);
  if (
    existing.some(
      (row) =>
        row.fingerprint === print &&
        row.orgIdentifier === org &&
        row.projectIdentifier === project,
    )
  ) {
    return { ok: false, error: "duplicate" };
  }
  if (existing.length >= MAX_TEMPLATE_SOURCES) {
    return { ok: false, error: "too_many" };
  }

  const [check, accountName] = await Promise.all([
    checkTemplateSource(raw, org, project || null),
    harnessAccountName(raw),
  ]);

  if (!check.tokenOk) {
    return { ok: false, error: "invalid_token", detail: check.detail };
  }
  if (!check.orgOk) {
    return { ok: false, error: "org_not_found", detail: check.detail };
  }
  if (check.projectOk === false) {
    return { ok: false, error: "project_not_found", detail: check.detail };
  }

  let secret: Buffer;
  try {
    secret = sealSecret(raw);
  } catch {
    return { ok: false, error: "no_key" };
  }

  const [row] = await db
    .insert(harnessTemplateSources)
    .values({
      userId: owner,
      accountId: parsed.accountId,
      accountName,
      orgIdentifier: org,
      orgName: check.orgName ?? null,
      projectIdentifier: project,
      projectName: check.projectName ?? null,
      tail: parsed.tail,
      fingerprint: print,
      secret,
      addedBy: userId,
    })
    .returning();

  return { ok: true, source: summarize(row!, null) };
}

export async function deleteTemplateSource(
  owner: SourceOwner,
  id: string,
): Promise<boolean> {
  const deleted = await db
    .delete(harnessTemplateSources)
    .where(and(ownedBy(owner), eq(harnessTemplateSources.id, id)))
    .returning({ id: harnessTemplateSources.id });
  return deleted.length > 0;
}

export async function templateSourceToken(id: string): Promise<string | null> {
  const [row] = await db
    .select({ secret: harnessTemplateSources.secret })
    .from(harnessTemplateSources)
    .where(eq(harnessTemplateSources.id, id));
  return row ? openSecret(row.secret) : null;
}
