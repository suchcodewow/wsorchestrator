import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { CLAIM_LIMITS, workshopAccounts, workshopRuns } from "@/db/schema";
import type { RunStatus } from "@/db/schema";

/**
 * The attendee-facing view of an event.
 *
 * This is the one place in the app that serves data to people who are not
 * signed in, so it is deliberately narrow: the event's name and kind, and the
 * account rows. Nothing about the organizer, the org unit, the cloud project,
 * the Terraform outputs, or the build log crosses this boundary — a visitor
 * holding the link learns only what they need to sit down and start working.
 */
export type AttendeeAccount = {
  id: number;
  email: string;
  tempPassword: string;
  claimedName: string | null;
  claimedFrom: string | null;
  claimedVacation: string | null;
  claimedAt: Date | null;
};

export type AttendeeView = {
  name: string;
  mode: "workshop" | "challenge";
  status: RunStatus;
  accounts: AttendeeAccount[];
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Load an event for its attendee page. Returns null for an unknown id, which
 * the page turns into a 404 — the same answer a real-but-finished event gives
 * once it has been reaped, so the link never reveals which it was.
 */
export async function getAttendeeView(
  runId: string,
): Promise<AttendeeView | null> {
  // The id comes straight off the URL. Postgres rejects a malformed uuid with
  // an error rather than an empty result, so anything that isn't one is a miss.
  if (!UUID.test(runId)) return null;

  const run = await db.query.workshopRuns.findFirst({
    where: eq(workshopRuns.id, runId),
    columns: { name: true, mode: true, status: true },
  });
  if (!run) return null;

  const accounts = await db.query.workshopAccounts.findMany({
    where: eq(workshopAccounts.runId, runId),
    orderBy: workshopAccounts.id,
    columns: {
      id: true,
      email: true,
      tempPassword: true,
      claimedName: true,
      claimedFrom: true,
      claimedVacation: true,
      claimedAt: true,
    },
  });

  return { ...run, accounts };
}

export type ClaimInput = {
  name: string;
  from: string;
  vacation: string;
};

export type ClaimError = "not_found" | "already_claimed" | "invalid";

/**
 * Take an account for oneself.
 *
 * Two attendees tapping the same row within a second of each other is the
 * expected case in a full room, not an edge case, so the write is a single
 * conditional update: `claimed_at is null` is the lock, and the loser gets
 * `already_claimed` back rather than silently overwriting the winner's name.
 *
 * The run id is part of the predicate as well, so a guessed account id from
 * another event cannot be written through this event's link.
 */
export async function claimAccount(
  runId: string,
  accountId: number,
  input: ClaimInput,
): Promise<
  { ok: true; account: AttendeeAccount } | { ok: false; error: ClaimError }
> {
  if (!UUID.test(runId)) return { ok: false, error: "not_found" };

  const name = input.name.trim();
  const from = input.from.trim();
  const vacation = input.vacation.trim();

  // A claim with no name would leave the row looking unclaimed to the room.
  if (
    name.length === 0 ||
    name.length > CLAIM_LIMITS.name ||
    from.length > CLAIM_LIMITS.from ||
    vacation.length > CLAIM_LIMITS.vacation
  ) {
    return { ok: false, error: "invalid" };
  }

  const [claimed] = await db
    .update(workshopAccounts)
    .set({
      claimedName: name,
      claimedFrom: from || null,
      claimedVacation: vacation || null,
      claimedAt: sql`now()`,
    })
    .where(
      and(
        eq(workshopAccounts.id, accountId),
        eq(workshopAccounts.runId, runId),
        isNull(workshopAccounts.claimedAt),
      ),
    )
    .returning({
      id: workshopAccounts.id,
      email: workshopAccounts.email,
      tempPassword: workshopAccounts.tempPassword,
      claimedName: workshopAccounts.claimedName,
      claimedFrom: workshopAccounts.claimedFrom,
      claimedVacation: workshopAccounts.claimedVacation,
      claimedAt: workshopAccounts.claimedAt,
    });

  if (claimed) return { ok: true, account: claimed };

  // No row updated: either the id is not this event's, or someone got there
  // first. Distinguishing the two is what tells the attendee whether to pick
  // another row or that the link is wrong.
  const existing = await db.query.workshopAccounts.findFirst({
    where: and(
      eq(workshopAccounts.id, accountId),
      eq(workshopAccounts.runId, runId),
    ),
    columns: { id: true },
  });
  return { ok: false, error: existing ? "already_claimed" : "not_found" };
}
