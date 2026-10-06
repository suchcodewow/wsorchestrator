/**
 * One Mindtickle pull for the Canary Wire, in the shape the canary-wire-reports
 * tool writes to `output/snapshot.json`, so the two can be compared directly.
 * xAPI hands back a learner's whole history in one call, so a single pull
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
