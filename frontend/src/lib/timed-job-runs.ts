/**
 * What each of the app's own timed jobs does when the dispatcher
 * (`dispatchTimedJobs` in `lib/timed-jobs.ts`) finds it due. Each runs the
 * same code as its Sync Now button, logged as the schedule's, so it keeps to
 * the same rules: the Google Meetings and Slack syncs are dry runs while they
 * are not live, and with the test group on they work on the group's invites
 * and channels and leave the real cohort's alone. `test/unit/timed-jobs.test.ts`
 * holds each run to its button's code.
 *
 * A run answers as its button's route does; `runTimedJob` records a non-2xx
 * answer as a failure, and `{ skipped: reason }` as a skip.
 */

import "server-only";

import { NextResponse } from "next/server";
import { scheduledStep } from "@/lib/canary-wire/pull";
import { runSlackSync } from "@/lib/cohorts/slack-sync";
import { STATUS_FOR, syncHibobEmployees } from "@/lib/evals/hibob";
import { runMeetingSync, SYNC_STATUS_FOR } from "@/lib/evals/meeting-sync";

export type TimedJobContext = {
  /** The app's own URL, for links a run sends out. */
  appUrl: string;
  /** When the run must stop by, leaving time to record it and answer. */
  deadline: number;
};

export type TimedJobRun = {
  run: (ctx: TimedJobContext) => Promise<Response>;
  /** A success body as the detail shown on the Timed Jobs tab. */
  describe: (body: Record<string, unknown>) => string | null;
};

export const TIMED_JOB_RUNS: Record<string, TimedJobRun> = {
  /**
   * The HiBob sync, then the cohort Slack sync: the channels, which skip
   * themselves when no bootcamp is active, then the day's intake form
   * reminders, which skip themselves while the daily reminder is off. The
   * Slack sync's failure is logged on Cohort Settings → Slack and does not
   * fail the job: the HiBob sync it follows went through.
   */
  "hibob-sync": {
    async run({ appUrl, deadline }) {
      const result = await syncHibobEmployees("schedule", null);
      if (!result.ok) {
        return NextResponse.json({ error: result.error, detail: result.detail }, { status: STATUS_FOR[result.error] });
      }
      const slack = await runSlackSync("schedule", null, deadline, { scope: "all", appUrl }).catch((err: unknown) => ({
        ok: false as const,
        runId: null,
        error: "failed",
        detail: err instanceof Error ? err.message : String(err),
      }));
      return NextResponse.json({ count: result.count, skipped: result.skipped, slack });
    },
    describe: (body) => (typeof body.count === "number" ? `${body.count} employees synced` : null),
  },

  /** Sync Now on eVals Settings → Google Meetings, without preview. */
  "google-meetings-sync": {
    async run({ deadline }) {
      const result = await runMeetingSync("schedule", null, deadline);
      if (!result.ok) {
        return NextResponse.json({ error: result.error, detail: result.detail, runId: result.runId }, { status: SYNC_STATUS_FOR[result.error] });
      }
      return NextResponse.json(result);
    },
    describe: (body) => {
      if (typeof body.invited !== "number" || typeof body.removed !== "number") return null;
      const summary = `${body.invited} invited, ${body.removed} removed`;
      return body.dryRun === true ? `Dry run: ${summary}` : summary;
    },
  },

  /**
   * One step of the Canary Wire's pull: work on one already running, or start
   * one if none started in the last 90 minutes. A deployment with no
   * Mindtickle tenant skips it.
   */
  "canary-wire-pull": {
    async run() {
      const { outcome, pull } = await scheduledStep();
      if (outcome === "not_configured") return NextResponse.json({ skipped: "Mindtickle is not configured" });
      return NextResponse.json({ outcome, pull });
    },
    describe: (body) => (typeof body.outcome === "string" ? `Pull ${body.outcome}` : null),
  },
};
