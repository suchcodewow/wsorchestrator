/**
 * What the cohort Slack channel sync should do, worked out without touching
 * Slack or the database: the active bootcamp's channel names, who belongs in
 * each, and who to invite or remove given who is there now. Pure, so the unit
 * suite covers the rules; `slack-sync.ts` does the calling.
 *
 * The channels are `sales-bootcamp-nov-2026`, `se-bootcamp-nov-2026` and, when
 * the bootcamp holds an intermediate class, `sales-intermediate-nov-2026` and
 * `se-intermediate-nov-2026`: the month and year of its start date. A `sales-`
 * channel holds the stage's Sales and Engineer cohort and the Bootcamp
 * Contacts; an `se-` channel its Engineers and the Engineer Contacts.
 */

import type { ChannelContactKind } from "@/db/schema";

export const COHORT_CHANNEL_KINDS = ["sales_bootcamp", "se_bootcamp", "sales_intermediate", "se_intermediate"] as const;
export type CohortChannelKind = (typeof COHORT_CHANNEL_KINDS)[number];

export type CohortStage = "bootcamp" | "intermediate";

export type CohortChannel = {
  kind: CohortChannelKind;
  name: string;
  /** Whose contacts it takes, and whose cohort: `sales` takes Sales and Engineers, `se` Engineers alone. */
  prefix: ChannelContactKind;
  stage: CohortStage;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;

/** `nov-2026` for a start date of `2026-11-09`. */
export function channelSuffix(startDate: string): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(startDate);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  if (!match || !month) throw new Error(`Not a YYYY-MM-DD date: ${startDate}`);
  return `${month}-${match[1]}`;
}

/** The bootcamp's channels, the intermediate ones only when it holds an intermediate class. */
export function cohortChannels(startDate: string, holdsIntermediate: boolean): CohortChannel[] {
  const suffix = channelSuffix(startDate);
  const stages: CohortStage[] = holdsIntermediate ? ["bootcamp", "intermediate"] : ["bootcamp"];
  return stages.flatMap((stage) =>
    (["sales", "se"] as const).map((prefix) => ({
      kind: `${prefix}_${stage}` as CohortChannelKind,
      name: `${prefix}-${stage}-${suffix}`,
      prefix,
      stage,
    })),
  );
}

export type CohortMember = { email: string; stage: CohortStage; track: "sales" | "engineer" };
export type ChannelContact = { email: string; kind: ChannelContactKind };

/** Each channel's emails, lowercased: its stage's cohort on the tracks it takes, then its contacts. */
export function channelAudience(
  channel: CohortChannel,
  cohort: readonly CohortMember[],
  contacts: readonly ChannelContact[],
): Set<string> {
  const emails = new Set<string>();
  for (const m of cohort) {
    if (m.stage === channel.stage && (channel.prefix === "sales" || m.track === "engineer")) {
      emails.add(m.email.toLowerCase());
    }
  }
  for (const c of contacts) {
    if (c.kind === channel.prefix) emails.add(c.email.toLowerCase());
  }
  return emails;
}

export type MembershipPlan = {
  /** Slack ids to invite: wanted, and not in the channel. */
  invite: string[];
  /** Slack ids to remove: ones the sync invited, still there, and no longer wanted. */
  remove: string[];
  /** Slack ids the sync invited who have since left: no longer to be remembered. */
  forget: string[];
};

/**
 * Who to invite and remove. Only someone in `invitedBySync` is ever removed,
 * so anyone added by hand, or already there when the sync first ran, stays.
 * Someone the sync invited who left on their own is forgotten, and invited
 * again if they are still wanted.
 */
export function planMembership({
  wanted,
  members,
  invitedBySync,
}: {
  wanted: ReadonlySet<string>;
  members: ReadonlySet<string>;
  invitedBySync: ReadonlySet<string>;
}): MembershipPlan {
  const invite = [...wanted].filter((id) => !members.has(id));
  const remove = [...invitedBySync].filter((id) => members.has(id) && !wanted.has(id));
  const forget = [...invitedBySync].filter((id) => !members.has(id));
  return { invite: invite.sort(), remove: remove.sort(), forget: forget.sort() };
}
