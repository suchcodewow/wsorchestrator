import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  harnessComponentSets,
  harnessComponents,
  workshopRuns,
  type ComponentSetStatus,
} from "@/db/schema";
import type { ValidComponent } from "./validate";

/**
 * Reading and writing the Harness component catalog.
 *
 * Two populations live in one table. The published baseline is the rows with a
 * null `setId` — what every workshop deploys. A candidate set is one
 * contributor's proposal, overlaid on that baseline by identifier when a
 * sandbox run deploys it.
 *
 * The lifecycle is deliberately short. A set is created by testing, not by
 * submitting, so the work is already here by the time anyone offers it; and
 * approval folds its rows into the baseline rather than leaving them
 * addressable, so there is exactly one place to look for what a workshop gets.
 */

/** One component as the catalog stores it. */
export type CatalogComponent = ValidComponent & { builtin: boolean };

/** The published baseline: the components every workshop deploys. */
export async function listBaseline(): Promise<CatalogComponent[]> {
  const rows = await db
    .select()
    .from(harnessComponents)
    .where(isNull(harnessComponents.setId))
    .orderBy(asc(harnessComponents.identifier));

  return rows.map(toCatalogComponent);
}

/** The components proposed by one candidate set. */
export async function listSetComponents(
  setId: string,
): Promise<CatalogComponent[]> {
  const rows = await db
    .select()
    .from(harnessComponents)
    .where(eq(harnessComponents.setId, setId))
    .orderBy(asc(harnessComponents.identifier));

  return rows.map(toCatalogComponent);
}

type ComponentRow = typeof harnessComponents.$inferSelect;

/** `jsonb` comes back as `unknown`; narrow it the way the runner does. */
const stringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

function toCatalogComponent(r: ComponentRow): CatalogComponent {
  return {
    identifier: r.identifier,
    kind: r.kind as CatalogComponent["kind"],
    scope: r.scope as CatalogComponent["scope"],
    name: r.name,
    description: r.description,
    spec: (r.spec ?? {}) as Record<string, unknown>,
    requires: stringArray(r.requires),
    dependsOn: stringArray(r.dependsOn),
    versionLabel: r.versionLabel,
    builtin: r.builtin,
  };
}

/**
 * Create a candidate set and its components in one transaction.
 *
 * Both together or neither: a set row with no components is a listing entry
 * that cannot be tested, reviewed, or explained, and it would sit in the
 * reviewer's queue looking like work.
 */
export async function createComponentSet(input: {
  name: string;
  authorId: string;
  components: ValidComponent[];
}): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [set] = await tx
      .insert(harnessComponentSets)
      .values({ name: input.name, authorId: input.authorId, status: "testing" })
      .returning({ id: harnessComponentSets.id });

    await tx.insert(harnessComponents).values(
      input.components.map((c) => ({
        setId: set!.id,
        identifier: c.identifier,
        kind: c.kind,
        scope: c.scope,
        name: c.name,
        description: c.description,
        spec: c.spec,
        requires: c.requires,
        dependsOn: c.dependsOn,
        versionLabel: c.versionLabel,
        builtin: false,
      })),
    );

    return { id: set!.id };
  });
}

/**
 * Replace a candidate set's components with a new proposal.
 *
 * Wholesale rather than patched, for the same reason `labWorkshopGuides`
 * rewrites its ordering wholesale: the stored set is then always exactly what
 * was last submitted, with nothing surviving from an earlier attempt that the
 * contributor believes they removed.
 *
 * Only a set still being worked on may be rewritten. Editing one after it has
 * been submitted would change what a reviewer is looking at underneath them,
 * and editing an approved one would silently diverge from the baseline it was
 * folded into.
 */
export async function replaceSetComponents(
  setId: string,
  components: ValidComponent[],
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [set] = await tx
      .select({ status: harnessComponentSets.status })
      .from(harnessComponentSets)
      .where(eq(harnessComponentSets.id, setId));

    if (!set || set.status !== "testing") return false;

    await tx.delete(harnessComponents).where(eq(harnessComponents.setId, setId));
    await tx.insert(harnessComponents).values(
      components.map((c) => ({
        setId,
        identifier: c.identifier,
        kind: c.kind,
        scope: c.scope,
        name: c.name,
        description: c.description,
        spec: c.spec,
        requires: c.requires,
        dependsOn: c.dependsOn,
        versionLabel: c.versionLabel,
        builtin: false,
      })),
    );
    await tx
      .update(harnessComponentSets)
      .set({ updatedAt: new Date() })
      .where(eq(harnessComponentSets.id, setId));

    return true;
  });
}

/** Move a set along its lifecycle, only from the status that allows it. */
export async function setStatus(
  setId: string,
  from: ComponentSetStatus,
  to: ComponentSetStatus,
  notes?: string,
): Promise<boolean> {
  const updated = await db
    .update(harnessComponentSets)
    .set({
      status: to,
      updatedAt: new Date(),
      ...(notes === undefined ? {} : { notes }),
    })
    .where(
      and(
        eq(harnessComponentSets.id, setId),
        eq(harnessComponentSets.status, from),
      ),
    )
    .returning({ id: harnessComponentSets.id });

  return updated.length > 0;
}

/**
 * Approve a set: fold its components into the published baseline.
 *
 * An identifier the baseline already has is *replaced* — that is what proposing
 * a row with an existing identifier means, and the contributor tested it that
 * way, since the sandbox overlay resolves the same collision the same
 * direction. `builtin` survives the replacement: whether a component is one the
 * repo seeds is a fact about where it came from, not about who last edited it,
 * and losing it would make a seeded connector deletable.
 *
 * The set's own rows stay put and the set is marked approved. They are the
 * record of what was proposed, which a baseline row overwritten by a later
 * change no longer tells anyone.
 */
export async function approveComponentSet(
  setId: string,
  notes: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [set] = await tx
      .select({ status: harnessComponentSets.status })
      .from(harnessComponentSets)
      .where(eq(harnessComponentSets.id, setId));

    if (!set || set.status !== "submitted") return false;

    const proposed = await tx
      .select()
      .from(harnessComponents)
      .where(eq(harnessComponents.setId, setId));

    for (const c of proposed) {
      await tx
        .insert(harnessComponents)
        .values({
          setId: null,
          identifier: c.identifier,
          kind: c.kind,
          scope: c.scope,
          name: c.name,
          description: c.description,
          spec: c.spec,
          requires: c.requires,
          dependsOn: c.dependsOn,
          versionLabel: c.versionLabel,
          builtin: false,
        })
        // The baseline's unique index is partial — `where set_id is null` — so
        // the conflict target must name that predicate too, or Postgres cannot
        // tell which index this upsert means.
        .onConflictDoUpdate({
          target: harnessComponents.identifier,
          targetWhere: isNull(harnessComponents.setId),
          set: {
            kind: c.kind,
            scope: c.scope,
            name: c.name,
            description: c.description,
            spec: c.spec,
            requires: c.requires,
            dependsOn: c.dependsOn,
            versionLabel: c.versionLabel,
            updatedAt: new Date(),
          },
        });
    }

    await tx
      .update(harnessComponentSets)
      .set({ status: "approved", notes, updatedAt: new Date() })
      .where(eq(harnessComponentSets.id, setId));

    return true;
  });
}

/** A candidate set with its author and the sandbox runs that exercised it. */
export async function listComponentSets(status?: ComponentSetStatus) {
  return db
    .select({
      id: harnessComponentSets.id,
      name: harnessComponentSets.name,
      status: harnessComponentSets.status,
      notes: harnessComponentSets.notes,
      authorId: harnessComponentSets.authorId,
      updatedAt: harnessComponentSets.updatedAt,
      componentCount: sql<number>`(
        select count(*)::int from ${harnessComponents}
         where ${harnessComponents.setId} = ${harnessComponentSets.id}
      )`,
      // The runs that tested it — the reason there is no `runId` on the set.
      runCount: sql<number>`(
        select count(*)::int from ${workshopRuns}
         where ${workshopRuns.componentSetId} = ${harnessComponentSets.id}
      )`,
    })
    .from(harnessComponentSets)
    .where(status ? eq(harnessComponentSets.status, status) : undefined)
    .orderBy(asc(harnessComponentSets.updatedAt));
}
