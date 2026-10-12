/**
 * The test group's rules that need no database: what a suffix may be, and how
 * the group stands in for the cohort. Pure, so the unit suite covers them.
 */

export type TestGroupMember = { email: string; fullName: string };

/** The longest suffix; a Slack channel name is 80 characters, and the longest cohort channel's is 31. */
export const TEST_GROUP_SUFFIX_MAX = 40;

/**
 * A suffix as it goes on a Slack channel name: lowercase letters, digits and
 * single hyphens, so `Smoke Test 2` is `smoke-test-2`. Empty if nothing is left.
 */
export function testGroupSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, TEST_GROUP_SUFFIX_MAX)
    .replace(/-+$/g, "");
}

const STAGES = ["bootcamp", "intermediate"] as const;
const TRACKS = ["sales", "engineer"] as const;

/**
 * The test group as the cohort: each member is in every stage on every track,
 * so every channel, meeting and reminder that draws from the cohort reaches them.
 */
export function testGroupAsCohort(members: readonly TestGroupMember[]) {
  return members.flatMap((m) =>
    STAGES.flatMap((stage) =>
      TRACKS.map((track) => ({
        email: m.email.trim().toLowerCase(),
        fullName: m.fullName,
        stage,
        track,
      })),
    ),
  );
}

/** Members lowercased, each email once, in the order given. */
export function dedupeMembers(
  members: readonly TestGroupMember[],
): TestGroupMember[] {
  const seen = new Map<string, TestGroupMember>();
  for (const m of members) {
    const email = m.email.trim().toLowerCase();
    if (email && !seen.has(email))
      seen.set(email, { email, fullName: m.fullName.trim() });
  }
  return [...seen.values()];
}
