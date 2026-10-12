/**
 * The cohort test group: while it is on, everything the app sends outside
 * itself for the cohort — Slack channels and their invites, intake reminders,
 * Google Calendar invites — goes to the people in the group instead, under
 * names carrying the group's suffix, and never touches the real cohort's
 * channels or invites. Platform administrators set it up on the Cohorts page's
 * Current tab. Turning it off takes away what it made (`test-group-teardown.ts`).
 */

import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  EVALS_SETTINGS_KEYS,
  TEST_GROUP_MAX_MEMBERS,
  evalsSettings,
  testGroupArtifacts,
  type TestGroupArtifactKind,
} from "@/db/schema";
import {
  dedupeMembers,
  testGroupAsCohort,
  type TestGroupMember,
} from "@/lib/cohorts/test-group-plan";
import { currentCohortEmails } from "@/lib/evals/current-cohort";

export type TestGroup = {
  on: boolean;
  suffix: string;
  members: TestGroupMember[];
};

async function readSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: evalsSettings.value })
    .from(evalsSettings)
    .where(eq(evalsSettings.key, key));
  return row?.value ?? null;
}

async function writeSetting(
  actorId: string,
  key: string,
  value: string,
): Promise<void> {
  await db
    .insert(evalsSettings)
    .values({ key, value, updatedBy: actorId })
    .onConflictDoUpdate({
      target: evalsSettings.key,
      set: { value, updatedBy: actorId, updatedAt: new Date() },
    });
}

function parseMembers(raw: string | null): TestGroupMember[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return dedupeMembers(
      parsed.flatMap((m) =>
        m && typeof m.email === "string"
          ? [
              {
                email: m.email,
                fullName: typeof m.fullName === "string" ? m.fullName : "",
              },
            ]
          : [],
      ),
    ).slice(0, TEST_GROUP_MAX_MEMBERS);
  } catch {
    return [];
  }
}

export async function getTestGroup(): Promise<TestGroup> {
  const [on, suffix, members] = await Promise.all([
    readSetting(EVALS_SETTINGS_KEYS.testGroupOn),
    readSetting(EVALS_SETTINGS_KEYS.testGroupSuffix),
    readSetting(EVALS_SETTINGS_KEYS.testGroupMembers),
  ]);
  return {
    on: on === "true",
    suffix: suffix ?? "",
    members: parseMembers(members),
  };
}

export async function saveTestGroup(
  actorId: string,
  change: { on?: boolean; suffix?: string; members?: TestGroupMember[] },
): Promise<void> {
  if (change.suffix !== undefined)
    await writeSetting(
      actorId,
      EVALS_SETTINGS_KEYS.testGroupSuffix,
      change.suffix,
    );
  if (change.members !== undefined) {
    await writeSetting(
      actorId,
      EVALS_SETTINGS_KEYS.testGroupMembers,
      JSON.stringify(dedupeMembers(change.members)),
    );
  }
  if (change.on !== undefined)
    await writeSetting(
      actorId,
      EVALS_SETTINGS_KEYS.testGroupOn,
      change.on ? "true" : "false",
    );
}

/**
 * The cohort whatever leaves the app is for: the real one, or with the test
 * group on, the test group standing in for it. `suffix` is set only then.
 */
export async function outboundCohort() {
  const group = await getTestGroup();
  if (!group.on)
    return {
      cohort: await currentCohortEmails(),
      testSuffix: null as string | null,
      group,
    };
  return {
    cohort: testGroupAsCohort(group.members),
    testSuffix: group.suffix,
    group,
  };
}

export async function recordTestArtifact(
  kind: TestGroupArtifactKind,
  key: string,
  ref: string | null = null,
): Promise<void> {
  await db
    .insert(testGroupArtifacts)
    .values({ kind, key, ref })
    .onConflictDoUpdate({
      target: [testGroupArtifacts.kind, testGroupArtifacts.key],
      set: { ref },
    });
}

export async function testArtifacts(kind: TestGroupArtifactKind) {
  return db
    .select()
    .from(testGroupArtifacts)
    .where(eq(testGroupArtifacts.kind, kind))
    .limit(1000);
}

export async function forgetTestArtifact(
  kind: TestGroupArtifactKind,
  key: string,
): Promise<void> {
  await db
    .delete(testGroupArtifacts)
    .where(
      and(eq(testGroupArtifacts.kind, kind), eq(testGroupArtifacts.key, key)),
    );
}
