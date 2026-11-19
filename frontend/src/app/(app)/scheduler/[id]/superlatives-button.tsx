"use client";

/**
 * The schedule's "Send Superlatives" button: a manager presses it, and
 * confirms, to send the Bootcamp's superlatives survey to the whole class,
 * Sales and Engineers together. It then becomes "Unassign Superlatives",
 * which takes it back from the class but keeps every vote. Everyone else sees
 * "Superlatives Sent" once it is out; both say how many have voted on hover.
 * The server announces it in the class's Slack channel; the manager is told
 * only when that did not happen.
 */

import { useState } from "react";
import { Check, Loader2, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm";
import type { SuperlativeStatus } from "@/lib/surveys/superlative-values";
import type { SurveySlackOutcome } from "@/lib/surveys/survey-values";

const ERRORS: Record<string, string> = {
  impersonating: "You are viewing the app as someone else, so the superlatives cannot be sent.",
  no_superlatives: "There are no superlatives to send. Add them in Logistics settings → Superlatives first.",
  no_class: "The Bootcamp class has fewer than two people, so there is no one to vote for.",
  not_found: "This bootcamp no longer exists.",
};

/** Why the channel was not pinged, when it was not. */
function slackNotice({ channel, status, error }: SurveySlackOutcome): string | null {
  switch (status) {
    case "posted":
      return null;
    case "dry_run":
      return `Superlatives sent. The Slack sync is in dry run, so #${channel} was not pinged.`;
    case "no_channel":
      return `Superlatives sent, but #${channel} has not been made yet, so no one was pinged in Slack.`;
    case "not_connected":
      return `Superlatives sent, but Slack is not connected, so #${channel} was not pinged.`;
    case "failed":
      return `Superlatives sent, but Slack refused the ping to #${channel} (${error ?? "unknown error"}).`;
  }
}

export function SuperlativesButton({
  bootcampId,
  initial,
  listed,
  canManage,
  onNotice,
}: {
  bootcampId: string;
  /** Whether they are out, and how many have voted; null while they are not. */
  initial: SuperlativeStatus | null;
  /** How many superlatives the standing list has, which a send asks. */
  listed: number;
  canManage: boolean;
  onNotice: (message: string) => void;
}) {
  const [status, setStatus] = useState(initial);
  // A refresh of the page brings a status that replaces the one kept here.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setStatus(initial);
  }
  const [busy, setBusy] = useState(false);

  async function call(method: "POST" | "DELETE") {
    setBusy(true);
    try {
      const res = await fetch(`/api/scheduler/bootcamps/${bootcampId}/superlatives`, { method });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        onNotice(ERRORS[body?.error ?? ""] ?? `Could not ${method === "POST" ? "send" : "unassign"} the superlatives (${res.status}).`);
        return;
      }
      setStatus(body.status);
      const notices = [
        body.survey?.hasMore ? "The class has more people than a survey takes; some were not sent the superlatives." : null,
        body.slack ? slackNotice(body.slack) : null,
      ].filter(Boolean);
      if (notices.length > 0) onNotice(notices.join(" "));
    } catch {
      onNotice("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (listed === 0) {
      onNotice(ERRORS.no_superlatives!);
      return;
    }
    const confirmed = await confirmDialog({
      title: "Send the superlatives now?",
      description: `The ${listed} ${listed === 1 ? "superlative" : "superlatives"} on the standing list will be sent to the whole Bootcamp class, Sales and Engineers together, to vote for their classmates.`,
      confirmLabel: "Send",
    });
    if (confirmed) await call("POST");
  }

  async function unassign() {
    const confirmed = await confirmDialog({
      title: "Unassign the superlatives?",
      description: "The class will no longer see the superlatives survey. Votes already given are kept.",
      confirmLabel: "Unassign",
      destructive: true,
    });
    if (confirmed) await call("DELETE");
  }

  const voted = status ? `${status.answered} of ${status.assigned} voted` : undefined;
  if (status && !canManage) {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground" title={voted}>
        <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
        Superlatives Sent
      </span>
    );
  }
  if (!canManage) return null;
  return status ? (
    <Button variant="outline" size="sm" disabled={busy} title={voted} onClick={() => void unassign()}>
      {busy ? <Loader2 className="animate-spin" /> : <Trophy />}
      Unassign Superlatives
    </Button>
  ) : (
    <Button variant="outline" size="sm" disabled={busy} onClick={() => void send()}>
      {busy ? <Loader2 className="animate-spin" /> : <Trophy />}
      Send Superlatives
    </Button>
  );
}
