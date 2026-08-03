import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { CLAIM_LIMITS, workshopAccounts, workshopRuns } from "@/db/schema";
import type { RunStatus } from "@/db/schema";

/**
 * The attendee-facing view of an event.
 *
 * This is the one place in the app that serves data to people who are not
 * signed in, so it is deliberately narrow: the event's name and kind, the
 * account rows, and — the one deliberate exception — the id of the Google
 * Cloud project(s) attendees were granted, so the page can link them straight
 * to its console. A project id is not a secret: everyone here is an editor on
 * that project and sees the id the moment they open the console. Nothing about
 * the organizer, the org unit, the Terraform outputs, or the build log crosses
 * this boundary.
 */
export type AttendeeAccount = {
  id: number;
  email: string;
  tempPassword: string;
  claimedName: string | null;
  claimedFrom: string | null;
  claimedVacation: string | null;
  claimedAt: Date | null;
  /**
   * This competitor's own GCP project, on a GCP challenge. Null otherwise — a
   * workshop shares one project, carried on the view instead of per row.
   */
  gcpProjectId: string | null;
};

export type AttendeeView = {
  name: string;
  mode: "workshop" | "challenge";
  status: RunStatus;
  /** The workshop's shared GCP project, if it requested GCP. Null otherwise. */
  gcpProjectId: string | null;
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
    columns: {
      name: true,
      mode: true,
      status: true,
      gcpProjectId: true,
      outputs: true,
    },
  });
  if (!run) return null;

  const rows = await db.query.workshopAccounts.findMany({
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

  // On a GCP challenge the per-competitor project ids are in the run outputs,
  // keyed by the address the project was granted to (see the `gcp_projects`
  // output on `challenges/gcp-per-user`). A workshop leaves this empty and
  // carries its one shared project on the view instead.
  const perUserProjects =
    (run.outputs as { gcp_projects?: Record<string, string> } | null)
      ?.gcp_projects ?? {};

  const accounts: AttendeeAccount[] = rows.map((a) => ({
    ...a,
    gcpProjectId: perUserProjects[a.email] ?? null,
  }));

  return {
    name: run.name,
    mode: run.mode,
    status: run.status,
    gcpProjectId: run.gcpProjectId,
    accounts,
  };
}

export type SaveFieldsInput = {
  name: string;
  from: string;
  vacation: string;
};

export type SaveFieldsError = "not_found" | "invalid";

/**
 * Save an account row's shared answers, as the room types them.
 *
 * There is no lock: the row is a communal scratchpad, not a claim to win. Any
 * visitor may edit any field of any row, the last write wins, and everyone sees
 * it on their next poll — two people typing into the same row is a harmless
 * collision the workshop laughs off, not an error to guard against. The write
 * is a plain update; the run id is in the predicate so a guessed account id
 * from another event still cannot be written through this event's link.
 *
 * `claimedAt` is kept only as the "row has a name" marker the room's counter
 * reads: stamped the first time a name is entered, kept afterwards, cleared if
 * the name is removed again.
 */
export async function saveAttendeeFields(
  runId: string,
  accountId: number,
  input: SaveFieldsInput,
): Promise<{ ok: true } | { ok: false; error: SaveFieldsError }> {
  if (!UUID.test(runId)) return { ok: false, error: "not_found" };

  const name = input.name.trim();
  const from = input.from.trim();
  const vacation = input.vacation.trim();

  if (
    name.length > CLAIM_LIMITS.name ||
    from.length > CLAIM_LIMITS.from ||
    vacation.length > CLAIM_LIMITS.vacation
  ) {
    return { ok: false, error: "invalid" };
  }

  const [saved] = await db
    .update(workshopAccounts)
    .set({
      claimedName: name || null,
      claimedFrom: from || null,
      claimedVacation: vacation || null,
      claimedAt: sql`case when ${name} <> '' then coalesce(${workshopAccounts.claimedAt}, now()) else null end`,
    })
    .where(
      and(
        eq(workshopAccounts.id, accountId),
        eq(workshopAccounts.runId, runId),
      ),
    )
    .returning({ id: workshopAccounts.id });

  // No row updated means the id is not this event's — a guessed or stale id.
  return saved ? { ok: true } : { ok: false, error: "not_found" };
}
