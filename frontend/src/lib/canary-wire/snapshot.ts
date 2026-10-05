/**
 * One Mindtickle pull for the Canary Wire, in the shape the canary-wire-reports
 * tool writes to `output/snapshot.json`, so a file from it can be uploaded as
 * is. xAPI hands back a learner's whole history in one call, so a single pull
 * fills every month and the page slices it rather than fetching again.
 */

import { z } from "zod";

export const COMPLETED = "Completed";
export const NOT_STARTED = "Not Started";

/** Mindtickle's `userState` for an account that exists but was never activated. */
export const NOT_ACTIVATED = "ADDED";

/** Whitespace-collapsed and lowercased, as states and names are compared. */
export const norm = (text: string | null | undefined) => (text ?? "").toLowerCase().split(/\s+/).filter(Boolean).join(" ");

const text = z.string().max(2_000).catch("");

const learner = z.object({
  email: z.string().min(3).max(320),
  name: text,
  /** The edition whose role group they are in: "AE and Supporting Orgs", "SE", "SDR". */
  role: z.string().min(1).max(200),
  manager: text,
  manager_email: text,
  title: text,
  /** `userState`; departed (`DEACTIVATED`) staff are left out before the pull ever stores them. */
  state: text,
});

const mtModule = z.object({
  module_id: z.string().min(1).max(100),
  name: text,
  /** The name less its month prefix: "Flex Pricing". */
  label: z.string().max(2_000),
  /** "September 2026", or "" for a module with no month prefix, which appears under no month. */
  month: text,
  edition: z.string().min(1).max(200),
  /** The series it was listed under, so a link opens it where the rep is enrolled. */
  series_id: text,
  /** `UPDATE` for nearly all; one is `ASSESSMENT`. A path segment in the learner URL. */
  type: text,
});

const progressEntry = z.object({
  state: text,
  /** The event's day, `YYYY-MM-DD`, or "". */
  on: text,
  /** The event's moment, ISO UTC, or "" (an older pull stored days only). */
  at: text,
});

export const canaryWireSnapshotSchema = z.object({
  fetched_at: z.string().min(10).max(64),
  generated_at: text,
  learners: z.array(learner).min(1).max(5_000),
  modules: z.array(mtModule).max(5_000),
  /** email → module id → that learner's furthest state in it. */
  progress: z.record(z.string(), z.record(z.string(), progressEntry)),
  notes: z.array(z.string().max(2_000)).max(500).catch([]),
});

export type CanaryWireSnapshot = z.infer<typeof canaryWireSnapshotSchema>;
export type SnapshotLearner = CanaryWireSnapshot["learners"][number];
export type SnapshotModule = CanaryWireSnapshot["modules"][number];
export type ProgressEntry = z.infer<typeof progressEntry>;

/**
 * Notes the tool used to write and has since retired. A pull is read for
 * weeks, so they are dropped on the way in rather than waiting for the next.
 */
const RETIRED_NOTES = ["left out of every rate", "departed staff still sitting", "appear under no month"];

export type SnapshotProblem = "not_json" | "invalid";

/**
 * Reads an uploaded `snapshot.json`. Only the fields the page uses are kept:
 * the file also lists departed staff (`excluded`) and every learner's
 * department and Mindtickle id, none of which this needs to hold.
 */
export function parseSnapshot(raw: string): { ok: true; snapshot: CanaryWireSnapshot } | { ok: false; error: SnapshotProblem; detail?: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "not_json" };
  }
  const parsed = canaryWireSnapshotSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: "invalid", detail: issue ? `${issue.path.join(".") || "file"}: ${issue.message}` : undefined };
  }
  if (Number.isNaN(Date.parse(parsed.data.fetched_at))) {
    return { ok: false, error: "invalid", detail: "fetched_at: not a date" };
  }
  const snapshot = parsed.data;
  return { ok: true, snapshot: { ...snapshot, notes: snapshot.notes.filter((n) => n && !RETIRED_NOTES.some((r) => n.includes(r))) } };
}

/** Months somebody started or finished something in, oldest first. */
export function monthsWithProgress(snap: CanaryWireSnapshot): Set<string> {
  // Not-started is not progress: Mindtickle records one for every learner the
  // moment content is assigned, so counting it makes every month look active.
  const touched = new Set<string>();
  for (const states of Object.values(snap.progress)) {
    for (const [mid, entry] of Object.entries(states)) {
      if (norm(entry.state) !== norm(NOT_STARTED)) touched.add(mid);
    }
  }
  return new Set(snap.modules.filter((m) => m.month && touched.has(m.module_id)).map((m) => m.month));
}
