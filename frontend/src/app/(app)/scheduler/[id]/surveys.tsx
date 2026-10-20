"use client";

/**
 * The schedule's "Assign Surveys" button, at the foot of each day of each
 * track. A manager presses it to send that day's surveys to the class; it
 * then reads "Surveys Sent", for everyone, with how many have answered. The
 * server announces them in the class's Slack channel; the manager is told
 * only when that did not happen.
 */

import { useState, type ReactNode } from "react";
import { Check, ClipboardList, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TRACK_LABELS, stageOf } from "@/lib/scheduler/timeline";
import { trackDaySent, type SurveyDayStatus, type SurveySlackOutcome } from "@/lib/surveys/survey-values";
import type { BoardColumn } from "./board";

const ERRORS: Record<string, string> = {
  impersonating: "You are viewing the app as someone else, so surveys cannot be sent.",
  no_such_day: "That track no longer runs that day. Refresh the page.",
  not_found: "This bootcamp no longer exists.",
};

/** Why the channel was not pinged, when it was not. */
function slackNotice({ channel, status, error }: SurveySlackOutcome): string | null {
  switch (status) {
    case "posted":
      return null;
    case "dry_run":
      return `Surveys sent. The Slack sync is in dry run, so #${channel} was not pinged.`;
    case "no_channel":
      return `Surveys sent, but #${channel} has not been made yet, so no one was pinged in Slack.`;
    case "not_connected":
      return `Surveys sent, but Slack is not connected, so #${channel} was not pinged.`;
    case "failed":
      return `Surveys sent, but Slack refused the ping to #${channel} (${error ?? "unknown error"}).`;
  }
}

export function useSurveyButtons({
  bootcampId,
  days,
  canManage,
  onNotice,
}: {
  bootcampId: string;
  days: SurveyDayStatus[];
  canManage: boolean;
  onNotice: (message: string) => void;
}): { dayButton: (column: BoardColumn) => ReactNode } {
  const [sent, setSent] = useState(days);
  // A refresh of the page brings days that replace what was kept here.
  const [seen, setSeen] = useState(days);
  if (seen !== days) {
    setSeen(days);
    setSent(days);
  }
  const [busy, setBusy] = useState<string | null>(null);

  async function assign(column: BoardColumn) {
    setBusy(column.key);
    try {
      const res = await fetch(`/api/scheduler/bootcamps/${bootcampId}/surveys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track: column.track, day: column.day }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        onNotice(ERRORS[body?.error ?? ""] ?? `Could not send the surveys (${res.status}).`);
        return;
      }
      setSent(body.days);
      const notices = [
        body.surveys.some((s: { hasMore: boolean }) => s.hasMore)
          ? `${TRACK_LABELS[column.track]} has more attendees than a survey takes; some were not sent one.`
          : null,
        body.slack ? slackNotice(body.slack) : null,
      ].filter(Boolean);
      if (notices.length > 0) onNotice(notices.join(" "));
    } catch {
      onNotice("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  return {
    dayButton: (column) => {
      const label = `${TRACK_LABELS[column.track]}, Day ${column.day}`;
      if (trackDaySent(sent, column.track, column.day)) {
        const status = sent.find((d) => d.day === column.day && d.stage === stageOf(column.track));
        return (
          <span
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
            title={status ? `${status.answered} of ${status.assigned} answered` : undefined}
          >
            <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            Surveys Sent
          </span>
        );
      }
      if (!canManage) return null;
      return (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          disabled={busy !== null}
          aria-label={`Assign surveys for ${label}`}
          onClick={() => void assign(column)}
        >
          {busy === column.key ? <Loader2 className="size-3.5 animate-spin" /> : <ClipboardList className="size-3.5" />}
          Assign Surveys
        </Button>
      );
    },
  };
}
