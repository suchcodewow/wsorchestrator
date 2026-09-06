import "server-only";
import { asc, eq } from "drizzle-orm";
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

/**
 * Where the site may read Harness templates from: an organization, optionally
 * one project inside it, and the token that can see it.
 *
 * Site-wide rows an administrator manages, so nothing here is scoped by user —
 * the route's `canManageSettings` is the gate. Compare `@/lib/harness-tokens`,
 * where every statement carries a user id because those rows are personal.
 *
 * A source is only stored once Harness has confirmed all of it: the token
 * works, the org is there, and the project is there if one was chosen. That is
 * the same rule the personal tokens follow, and it is what makes the list a
 * list of places templates can actually be read from rather than of strings
 * somebody typed.
 */

/** A saved source as the settings page sees it — everything but the token. */
export type TemplateSourceRow = {
  id: string;
  accountId: string;
  /** What Harness calls the account, or null if the token cannot read it. */
  accountName: string | null;
  orgIdentifier: string;
  orgName: string | null;
  /** Null for "the whole org". Stored as an empty string; null is the API's word. */
  projectIdentifier: string | null;
  projectName: string | null;
  /** Last four characters of the token — all the UI ever shows again. */
  tail: string;
  createdAt: string;
  /** Who added it. Null once that account is deleted. */
  addedBy: string | null;
  /**
   * Whether the stored token can still be decrypted. False means the encryption
   * key changed underneath it, so the row cannot even be checked — and the fix
   * is deleting it and pasting the token again.
   */
  usable: boolean;
};

/** The live result of re-checking one row, as the table draws it. */
export type SourceStatus = {
  tokenOk: boolean;
  orgOk: boolean;
  projectOk: boolean | null;
  /** Everything the row claims is still true. */
  ok: boolean;
  /** What Harness said, when it refused. */
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
});

export async function listTemplateSources(): Promise<TemplateSourceRow[]> {
  const rows = await db
    .select({ source: harnessTemplateSources, byName: users.name, byEmail: users.email })
    .from(harnessTemplateSources)
    .leftJoin(users, eq(users.id, harnessTemplateSources.addedBy))
    .orderBy(
      asc(harnessTemplateSources.orgIdentifier),
      asc(harnessTemplateSources.projectIdentifier),
    );

  return rows.map((r) => summarize(r.source, r.byName ?? r.byEmail ?? null));
}

/**
 * Re-check every saved source against Harness, and say what came back.
 *
 * Run when the page is opened, which is the point: a token expires, an org is
 * deleted, a project is renamed, and a list that only ever showed what was true
 * on the day it was saved would keep claiming the source works. It costs one or
 * two Harness calls per row, all of them in flight together, on a page only
 * administrators open.
 *
 * Nothing is written. The findings are what Harness says *now*, so caching them
 * would only create a second answer to disagree with — and a re-check is a page
 * reload rather than a stored verdict with a date on it.
 */
export async function checkTemplateSources(
  rows: TemplateSourceRow[],
): Promise<Record<string, SourceStatus>> {
  if (rows.length === 0) return {};

  const secrets = await db
    .select({ id: harnessTemplateSources.id, secret: harnessTemplateSources.secret })
    .from(harnessTemplateSources);
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

/**
 * Check a token and a scope with Harness and, if all of it is real, save it.
 *
 * The names are read from Harness's answer rather than taken from the form the
 * pickers filled in: the identifiers are what matter and are what get stored,
 * and a display name that came round-trip through a browser is one more thing
 * that can disagree with the platform.
 */
export async function saveTemplateSource(
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
    .from(harnessTemplateSources);

  // Both answerable without Harness, so they are answered without sending a
  // credential to another system to earn a refusal we already know about.
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
    // Enrichment, and independent of the check — a name for the row, not a
    // reason to accept or refuse it.
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

/** Forget a source. Deleted outright — there is nothing to keep a record of. */
export async function deleteTemplateSource(id: string): Promise<boolean> {
  const deleted = await db
    .delete(harnessTemplateSources)
    .where(eq(harnessTemplateSources.id, id))
    .returning({ id: harnessTemplateSources.id });
  return deleted.length > 0;
}

/**
 * The usable token for one saved source, for code that needs to read templates
 * from it. Nothing calls this yet — it is the reason the token is encrypted
 * rather than hashed, and the seam a template import uses.
 */
export async function templateSourceToken(id: string): Promise<string | null> {
  const [row] = await db
    .select({ secret: harnessTemplateSources.secret })
    .from(harnessTemplateSources)
    .where(eq(harnessTemplateSources.id, id));
  return row ? openSecret(row.secret) : null;
}
