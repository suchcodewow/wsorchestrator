/** The component catalog: the baseline, and the sets proposed against it. */

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

export type CatalogComponent = ValidComponent & { builtin: boolean };

export async function listBaseline(): Promise<CatalogComponent[]> {
  const rows = await db
    .select()
    .from(harnessComponents)
    .where(isNull(harnessComponents.setId))
    .orderBy(asc(harnessComponents.identifier));

  return rows.map(toCatalogComponent);
}

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
      runCount: sql<number>`(
        select count(*)::int from ${workshopRuns}
         where ${workshopRuns.componentSetId} = ${harnessComponentSets.id}
      )`,
    })
    .from(harnessComponentSets)
    .where(status ? eq(harnessComponentSets.status, status) : undefined)
    .orderBy(asc(harnessComponentSets.updatedAt));
}
