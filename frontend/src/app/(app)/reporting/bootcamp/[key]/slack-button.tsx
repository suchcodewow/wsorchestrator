"use client";

/**
 * The Slack button on a Live Sessions card: opens the attendee's private
 * channel in the Slack app, making it or bringing its members in line first,
 * then says what changed and offers the channel in a browser too.
 */

import { useState } from "react";
import { Loader2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

type Opened = {
  name: string;
  created: boolean;
  unarchived: boolean;
  invited: string[];
  removed: string[];
  skipped: string[];
  callerIn: boolean;
  appUrl: string;
  webUrl: string;
};

const ERRORS: Record<string, string> = {
  not_found: "This person is no longer yours to see — reload the page.",
  dry_run: "Slack is in dry run, so no channel was opened. A platform administrator turns it live on Admin Settings → External Connectors.",
  not_configured: "Slack is not connected. An administrator adds the app on Admin Settings → External Connectors.",
  forbidden: "Your own role changed — reload the page.",
};

const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

function summary(o: Opened): string {
  const parts = [o.created ? `Made #${o.name}` : o.unarchived ? `Unarchived #${o.name}` : `Posted in #${o.name}`];
  if (o.invited.length > 0) parts.push(`invited ${people(o.invited.length)}`);
  if (o.removed.length > 0) parts.push(`took out ${people(o.removed.length)}`);
  return `${parts.join(", ")}.`;
}

export function SlackButton({ personKey }: { personKey: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    setOpened(null);
    try {
      const res = await fetch(`/api/reporting/bootcamp/people/${encodeURIComponent(personKey)}/slack`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(ERRORS[body?.error ?? ""] ?? (body?.detail ? `${body.detail}.` : `Could not open the channel (${res.status}).`));
        return;
      }
      setOpened(body);
      if (body.callerIn) window.location.href = body.appUrl;
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void open()}>
        {busy ? <Loader2 className="animate-spin" /> : <MessageSquare />}
        Discuss in Slack
      </Button>
      {error && (
        <p role="alert" className="max-w-sm text-xs text-destructive">
          {error}
        </p>
      )}
      {opened && (
        <p role="status" className="max-w-sm text-xs text-muted-foreground">
          {summary(opened)}{" "}
          {opened.callerIn ? (
            <a href={opened.webUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
              Open in a browser
            </a>
          ) : (
            "You are not in it: the app found no Slack account for you."
          )}
          {opened.skipped.length > 0 && (
            <span className="block">
              Not in Slack, or refused: {opened.skipped.join(", ")}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
