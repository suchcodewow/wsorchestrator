"use client";

/**
 * The intake form's daily Slack reminder: on or off, whether Slack can send
 * it and whether the sync sends or only logs, how many in each stage are
 * still to answer, and the last run that set out to send it. The cohort
 * Slack sync sends it, so it is sent by hand with Sync Slack Now there.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { INTAKE_FORM_IDS } from "@/db/schema";
import type { IntakeCounts } from "@/lib/logistics/intake-reminders";
import { INTAKE_FORM_LABELS } from "@/lib/logistics/intake-values";
import { riseChild, staggerParent } from "@/lib/motion";
import { formatWhen } from "../../cohort-settings/format";
import { RunResult, type SlackRun } from "../../cohort-settings/slack/slack-view";

const ERRORS: Record<string, string> = {
  forbidden: "Your own role changed — reload the page.",
};

const SLACK_TAB = "/cohort-settings/slack";

export function RemindersView({
  on,
  live,
  sentToday,
  lastRun,
  counts,
  slack,
}: {
  on: boolean;
  /** Whether the Slack sync sends, or in dry run only logs what it would. */
  live: boolean;
  sentToday: boolean;
  lastRun: SlackRun | null;
  counts: IntakeCounts;
  slack: { configured: boolean; missingScopes: string[] };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const outstanding = INTAKE_FORM_IDS.reduce(
    (n, id) => n + (counts[id].questions > 0 ? counts[id].asked - counts[id].answered : 0),
    0,
  );

  async function setOn(next: boolean) {
    if (
      next &&
      !window.confirm(
        live
          ? "Turn reminders on? From the next Slack sync, everyone in the current cohort who has not answered their form gets a Slack message once a day."
          : "Turn reminders on? The Slack sync is in dry run, so they will be logged on Cohort Settings → Slack, not sent, until it goes live.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/logistics/intake-reminders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: next }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) setError(ERRORS[body?.error ?? ""] ?? `Something went wrong (${res.status}).`);
      else router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="max-w-3xl space-y-6">
      <motion.div variants={riseChild} className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-medium tracking-tight">Slack reminders</h2>
          <p className="text-sm text-muted-foreground">
            {outstanding.toLocaleString()} in the current cohort still to answer
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href={SLACK_TAB}>
            <ExternalLink />
            Preview or send on Slack
          </Link>
        </Button>
      </motion.div>

      {!slack.configured && (
        <motion.p variants={riseChild} className="flex items-center gap-1.5 text-sm text-destructive">
          <AlertTriangle className="size-3.5 shrink-0" />
          Slack is not connected. Add the app on{" "}
          <Link href={SLACK_TAB} className="underline">
            Cohort Settings → Slack
          </Link>
          .
        </motion.p>
      )}
      {slack.configured && slack.missingScopes.length > 0 && (
        <motion.p variants={riseChild} className="flex items-center gap-1.5 text-sm text-destructive">
          <AlertTriangle className="size-3.5 shrink-0" />
          The Slack app cannot send messages: it is missing {slack.missingScopes.join(", ")}. Add it again on{" "}
          <Link href={SLACK_TAB} className="underline">
            Cohort Settings → Slack
          </Link>{" "}
          to grant them.
        </motion.p>
      )}

      {error && (
        <motion.p variants={riseChild} role="alert" className="text-sm text-destructive">
          {error}
        </motion.p>
      )}

      <motion.div variants={riseChild} className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div className="space-y-0.5">
            <p className="flex items-center gap-2 text-sm font-medium">
              Daily reminder
              {on ? <Badge>On</Badge> : <Badge variant="secondary">Off</Badge>}
              {on && !live && <Badge variant="secondary">Dry run</Badge>}
            </p>
            <p className="text-sm text-muted-foreground">
              {!on
                ? "Nobody is reminded, on the schedule or by Sync Slack Now."
                : !live
                  ? "The Slack sync is in dry run, so each day's reminders are logged on Cohort Settings → Slack but not sent."
                  : sentToday
                    ? "Today's have gone out; the next go out tomorrow, to whoever has still not answered."
                    : "Once a day, everyone in the current cohort who has not answered their form gets a Slack message with a link to it."}
            </p>
          </div>
          <Button variant="outline" disabled={busy} onClick={() => setOn(!on)}>
            {busy && <Loader2 className="animate-spin" />}
            {on ? "Turn off" : "Turn on"}
          </Button>
        </div>

        {INTAKE_FORM_IDS.map((id) => {
          const c = counts[id];
          return (
            <div key={id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <span className="text-sm font-medium">{INTAKE_FORM_LABELS[id]}</span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {c.questions === 0
                  ? `No questions yet, so none of the ${c.asked.toLocaleString()} in the stage is reminded`
                  : `${c.answered.toLocaleString()} of ${c.asked.toLocaleString()} answered`}
              </span>
            </div>
          );
        })}

        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <span className="text-sm font-medium">Last run</span>
          {lastRun ? (
            <Link
              href={`${SLACK_TAB}/${lastRun.id}?kind=messages`}
              className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <span className="underline-offset-2 hover:underline">{formatWhen(lastRun.startedAt)}</span>
              {lastRun.dryRun && <Badge variant="secondary">Dry run</Badge>}
              <RunResult run={lastRun} />
            </Link>
          ) : (
            <span className="text-sm text-muted-foreground">None yet</span>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
