/**
 * Pulling the Canary Wire from Mindtickle. One xAPI call per learner returns
 * their whole history, so a single pull fills every month — but ~300 learners
 * under Mindtickle's rate limit take ~15 minutes, longer than any request may
 * run. So a pull goes in steps: each works for at most `STEP_MS`, saves where
 * it got to in `canary_wire_pulls.state`, and lets go. Cloud Scheduler starts
 * one every two hours and takes its steps (`scheduledStep`); a pull started
 * by hand, for testing, is stepped by the page that started it.
 *
 * A step holds a lease on the pull while it works, so two never fetch at
 * once and double the request rate. A pull nobody has worked on for
 * `ABANDON_MS` is given up, so it can't hold the one-at-a-time slot forever.
 */

import "server-only";

import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { canaryWirePulls, users, type CanaryWirePullStatus, type CanaryWirePullTrigger } from "@/db/schema";
import { EDITIONS, EXCLUDE_MODULES, INCLUDE_USER_STATES } from "@/lib/canary-wire/config";
import { Mindtickle, MindtickleAuthError, MindtickleError, mindtickleConfig } from "@/lib/canary-wire/mindtickle";
import { bestProgress, learnerFrom, matchesAll, matchesAny, splitMonth, type MtRecord } from "@/lib/canary-wire/records";
import {
  canaryWireSnapshotSchema,
  norm,
  type ProgressEntry,
  type SnapshotLearner,
  type SnapshotModule,
} from "@/lib/canary-wire/snapshot";
import { saveSnapshot } from "@/lib/canary-wire/store";

/** How long one step works before saving and letting go; routes allow 300 s. */
export const STEP_MS = 240_000;
const ABANDON_MS = 6 * 60 * 60_000;
/**
 * A scheduled call starts no pull if one started within this, whatever became
 * of it. Under the scheduler's two hours, so each even hour starts one; over
 * its half-hour burst, so a failed pull waits for the next even hour rather
 * than being retried every five minutes.
 */
const SCHEDULE_GAP_MS = 90 * 60_000;
const SAVE_EVERY = 10;

type PullState = {
  fetchedAt: string;
  modules: SnapshotModule[];
  learners: SnapshotLearner[];
  progress: Record<string, Record<string, ProgressEntry>>;
  notes: string[];
  /** The next learner to fetch. */
  next: number;
  /** The newest statement `timestamp`, kept as the tool kept it, for diagnostics. */
  newest: string;
};

export type PullSummary = {
  id: string;
  trigger: CanaryWirePullTrigger;
  status: CanaryWirePullStatus;
  message: string;
  done: number;
  total: number;
  error: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  startedByName: string | null;
  /** A step is working on it right now. */
  working: boolean;
};

const summaryColumns = {
  id: canaryWirePulls.id,
  trigger: canaryWirePulls.trigger,
  status: canaryWirePulls.status,
  message: canaryWirePulls.message,
  done: canaryWirePulls.done,
  total: canaryWirePulls.total,
  error: canaryWirePulls.error,
  startedAt: canaryWirePulls.startedAt,
  updatedAt: canaryWirePulls.updatedAt,
  finishedAt: canaryWirePulls.finishedAt,
  leasedUntil: canaryWirePulls.leasedUntil,
  startedByName: users.name,
};

function selectPulls() {
  return db.select(summaryColumns).from(canaryWirePulls).leftJoin(users, eq(users.id, canaryWirePulls.startedBy));
}

function summarize(r: Awaited<ReturnType<typeof selectPulls>>[number]): PullSummary {
  return {
    id: r.id,
    trigger: r.trigger,
    status: r.status,
    message: r.message,
    done: r.done,
    total: r.total,
    error: r.error,
    startedAt: r.startedAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    startedByName: r.startedByName,
    working: r.status === "running" && !!r.leasedUntil && r.leasedUntil.getTime() > Date.now(),
  };
}

/** The newest pull, running or not; null before the first. */
export async function latestPull(): Promise<PullSummary | null> {
  const [row] = await selectPulls().orderBy(desc(canaryWirePulls.startedAt)).limit(1);
  return row ? summarize(row) : null;
}

/** Gives up a running pull nobody has worked on in `ABANDON_MS`, so another can start. */
async function abandonStale(): Promise<void> {
  await db
    .update(canaryWirePulls)
    .set({
      status: "failed",
      error: "Stopped: nothing worked on it for 6 hours.",
      state: null,
      leasedUntil: null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(canaryWirePulls.status, "running"),
        lt(canaryWirePulls.updatedAt, new Date(Date.now() - ABANDON_MS)),
        or(isNull(canaryWirePulls.leasedUntil), lt(canaryWirePulls.leasedUntil, sql`now()`)),
      ),
    );
}

export type StartError = "not_configured" | "running";

/** Starts a pull; its first step is someone else's call. */
export async function startPull(
  trigger: CanaryWirePullTrigger,
  startedBy: string | null,
): Promise<{ ok: true; pull: PullSummary } | { ok: false; error: StartError }> {
  if (!mindtickleConfig()) return { ok: false, error: "not_configured" };
  await abandonStale();
  const [row] = await db
    .insert(canaryWirePulls)
    .values({ trigger, startedBy, message: "Waiting to start" })
    .onConflictDoNothing()
    .returning({ id: canaryWirePulls.id });
  if (!row) return { ok: false, error: "running" };
  return { ok: true, pull: (await latestPull())! };
}

async function claim(): Promise<{ id: string; state: PullState | null; startedBy: string | null } | null> {
  const [row] = await db
    .update(canaryWirePulls)
    // Outlasts a step (STEP_MS) but not its route (300 s), so a step that
    // died is free to take up again soon after.
    .set({ leasedUntil: sql`now() + interval '290 seconds'` })
    .where(
      and(
        eq(canaryWirePulls.status, "running"),
        or(isNull(canaryWirePulls.leasedUntil), lt(canaryWirePulls.leasedUntil, sql`now()`)),
      ),
    )
    .returning({ id: canaryWirePulls.id, state: canaryWirePulls.state, startedBy: canaryWirePulls.startedBy });
  return row ? { id: row.id, state: row.state as PullState | null, startedBy: row.startedBy } : null;
}

async function save(id: string, state: PullState | null, fields: { message: string; done?: number; total?: number }) {
  await db
    .update(canaryWirePulls)
    .set({ state, ...fields, updatedAt: new Date() })
    .where(eq(canaryWirePulls.id, id));
}

async function finish(id: string, outcome: { status: "succeeded"; message: string } | { status: "failed"; error: string }) {
  await db
    .update(canaryWirePulls)
    .set({
      ...outcome,
      ...(outcome.status === "failed" ? { message: "Failed" } : {}),
      state: null,
      leasedUntil: null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(canaryWirePulls.id, id));
}

/** Rosters, series and modules: a few dozen requests, so always done within the first step. */
async function setup(mt: Mindtickle, say: (message: string) => Promise<void>): Promise<PullState> {
  const state: PullState = { fetchedAt: new Date().toISOString(), modules: [], learners: [], progress: {}, notes: [], next: 0, newest: "" };

  await say("Finding the Canary Wire series");
  const hits = await mt.listSeries();
  if (!hits.length) throw new MindtickleError("Mindtickle lists no series at all. The key pair may lack training scope.");
  const name = (h: MtRecord) => String(h.name ?? "");
  const series = EDITIONS.map((e) => {
    const matched = hits.filter((h) => matchesAll(name(h), e.match));
    if (matched.length !== 1) {
      const canary = hits.map(name).filter((n) => norm(n).includes("canary")).sort();
      throw new MindtickleError(
        matched.length
          ? `${matched.length} series match the ${e.edition} edition: ${matched.map(name).join(", ")}.`
          : `No series matches the ${e.edition} edition. Canary Wire series on the tenant: ${canary.join(", ") || "none"}.`,
      );
    }
    return { edition: e.edition, seriesId: String(matched[0]!.id), group: e.group };
  });

  await say("Finding the role groups");
  const groups = await mt.groupsNamed([...new Set(series.map((s) => s.group))]);
  const byName = new Map([...groups].map(([id, n]) => [norm(n), id]));
  const found = series.filter((s) => {
    if (byName.has(norm(s.group))) return true;
    state.notes.push(`${s.edition}: the group "${s.group}" isn't on Mindtickle, so this edition is missing entirely. Group names must match exactly.`);
    return false;
  });
  if (!found.length) throw new MindtickleError(`None of the role groups exist on Mindtickle: ${series.map((s) => s.group).join(", ")}.`);

  await say("Listing modules");
  for (const s of found) {
    for (const m of await mt.listSeriesModules(s.seriesId)) {
      const full = name(m);
      if (matchesAny(full, EXCLUDE_MODULES)) continue;
      const [month, label] = splitMonth(full);
      // The series is kept so a square links where this rep is enrolled: the
      // same module id sits under several series.
      state.modules.push({ module_id: String(m.id), name: full, label, month, edition: s.edition, series_id: s.seriesId, type: String(m.moduleType ?? "") });
    }
    if (!state.modules.some((m) => m.edition === s.edition && m.month)) {
      state.notes.push(`${s.edition}: no module name carries a "Month YYYY -" prefix, so its content can't be filed under a month.`);
    }
  }

  await say("Fetching rosters");
  const seen = new Set<string>();
  for (const s of found) {
    for (const u of await mt.usersInGroup(byName.get(norm(s.group))!)) {
      const learner = learnerFrom(u, s.edition);
      const key = learner.email.toLowerCase();
      if (!learner.email) continue;
      // Departed staff stay in their group forever. Not stored, not counted,
      // not mentioned — but remembered, so a second group can't bring them back.
      if (!INCLUDE_USER_STATES.includes(learner.state)) {
        seen.add(key);
        continue;
      }
      if (seen.has(key)) {
        state.notes.push(`${learner.email} is in more than one role group; counted once, under the first (${s.edition} skipped).`);
        continue;
      }
      seen.add(key);
      state.learners.push(learner);
    }
  }
  if (!state.learners.length) throw new MindtickleError("The Canary Wire role groups have no current learners with an email address.");
  return state;
}

/**
 * Works on the running pull for up to `budgetMs`, if there is one and no
 * other step has it. Returns the pull as it stands after, or null for none.
 */
export async function advancePull(budgetMs = STEP_MS): Promise<PullSummary | null> {
  await abandonStale();
  const claimed = await claim();
  if (!claimed) return latestPull();
  const config = mindtickleConfig();
  if (!config) {
    await finish(claimed.id, { status: "failed", error: "Mindtickle isn't configured: MT_API_KEY, MT_SECRET_KEY and MT_COMPANY_ID are unset." });
    return latestPull();
  }

  const deadline = Date.now() + budgetMs;
  const mt = new Mindtickle(config);
  const id = claimed.id;
  try {
    let state = claimed.state;
    if (!state) {
      state = await setup(mt, (message) => save(id, null, { message }));
      await save(id, state, { message: progressMessage(state), done: 0, total: state.learners.length });
    }
    // At least one learner a step, so even a step that starts late moves the pull on.
    for (let first = true; state.next < state.learners.length && (first || Date.now() < deadline); first = false) {
      const learner = state.learners[state.next]!;
      try {
        const { best, newest } = bestProgress(await mt.statementsFor(learner.email));
        state.progress[learner.email] = best;
        if (newest > state.newest) state.newest = newest;
      } catch (err) {
        if (err instanceof MindtickleAuthError || !(err instanceof MindtickleError)) throw err;
        // One learner's history failing costs that learner, not the pull.
        state.notes.push(`xAPI failed for ${learner.email}: ${err.message}`);
        state.progress[learner.email] = {};
      }
      state.next++;
      if (state.next % SAVE_EVERY === 0) await save(id, state, { message: progressMessage(state), done: state.next });
    }

    if (state.next < state.learners.length) {
      await save(id, state, { message: progressMessage(state), done: state.next });
      await db.update(canaryWirePulls).set({ leasedUntil: null }).where(eq(canaryWirePulls.id, id));
      return latestPull();
    }

    await save(id, state, { message: "Saving", done: state.next });
    const snapshot = canaryWireSnapshotSchema.parse({
      fetched_at: state.fetchedAt,
      generated_at: state.newest,
      learners: state.learners,
      modules: state.modules,
      progress: state.progress,
      notes: state.notes,
    });
    await saveSnapshot(snapshot, claimed.startedBy);
    await finish(id, { status: "succeeded", message: `Pulled ${state.learners.length} learners` });
  } catch (err) {
    console.error("canary-wire: pull failed", err);
    await finish(id, { status: "failed", error: err instanceof MindtickleError ? err.message : "Something went wrong talking to Mindtickle." });
  }
  return latestPull();
}

const progressMessage = (s: PullState) => `Fetching progress: ${s.next} of ${s.learners.length} learners`;

export type ScheduledOutcome = "advanced" | "started" | "fresh" | "not_configured";

/**
 * What Cloud Scheduler does each time it calls — every five minutes for the
 * first half hour of every even hour: work on a pull already running, or
 * start one if none started in the last `SCHEDULE_GAP_MS`. A pull that fails
 * isn't retried until the next even hour, so a revoked key costs one attempt
 * every two hours.
 */
export async function scheduledStep(budgetMs = STEP_MS): Promise<{ outcome: ScheduledOutcome; pull: PullSummary | null }> {
  if (!mindtickleConfig()) return { outcome: "not_configured", pull: null };
  await abandonStale();
  const latest = await latestPull();
  if (latest?.status === "running") return { outcome: "advanced", pull: await advancePull(budgetMs) };
  if (latest && Date.now() - new Date(latest.startedAt).getTime() < SCHEDULE_GAP_MS) return { outcome: "fresh", pull: latest };
  const started = await startPull("schedule", null);
  if (!started.ok) return { outcome: "advanced", pull: await advancePull(budgetMs) };
  return { outcome: "started", pull: await advancePull(budgetMs) };
}
