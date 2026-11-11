"use client";

/**
 * External Connectors: each outside account the app acts as, in one card. A
 * connect button leaves for the provider's consent screen and comes back
 * through the shared OAuth callback (lib/oauth-purposes.ts), which reports the
 * outcome in the query string. The Google and Slack boxes also hold each
 * one's mode: a dry run, which logs what the app would change and send
 * there, or live.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { AlertTriangle, Loader2, Plug, Unplug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { formatWhen } from "../../cohort-settings/format";
import { confirmDialog } from "@/components/ui/confirm";

type Person = { email: string; connectedBy: string | null; connectedAt: string };

export type SlackInstall = {
  teamId: string;
  teamName: string | null;
  missingScopes: string[];
  readable: boolean;
  installedBy: string | null;
  installedAt: string;
};

type Returned = { google: string | null; zoom: string | null; slack: string | null; current: string | null; detail: string | null };

type Message = { tone: "ok" | "error"; text: string };

function googleMessage(result: string, current: string | null): Message | null {
  const messages: Record<string, Message> = {
    connected: {
      tone: "ok",
      text: "Google is connected. Sync Now adds the cohort to the Revenue Enablement calendar's meetings as this account.",
    },
    denied: { tone: "error", text: "Google was not given access, so nothing changed." },
    expired: { tone: "error", text: "That sign-in took too long or started in another tab. Connect again." },
    failed: { tone: "error", text: "Google did not finish connecting. Connect again." },
    scope: { tone: "error", text: "The account was connected without calendar access. Connect again and allow it." },
    different_account: {
      tone: "error",
      text: `The old eVals meetings still have invites from ${current ?? "the connected account"}. Connect that account again, or run a live sync first, which cancels them.`,
    },
  };
  return messages[result] ?? null;
}

function zoomMessage(result: string): Message | null {
  const messages: Record<string, Message> = {
    connected: {
      tone: "ok",
      text: "Zoom is connected. Sync Now holds meetings in Zoom meetings this user hosts, and reads who joined them.",
    },
    denied: { tone: "error", text: "Zoom was not given access, so nothing changed." },
    expired: { tone: "error", text: "That sign-in took too long or started in another tab. Connect again." },
    failed: { tone: "error", text: "Zoom did not finish connecting. Connect again." },
    scope: {
      tone: "error",
      text: "Zoom did not grant every scope the app needs (meeting:read:list_past_instances, meeting:read:list_past_participants, meeting:read:meeting, meeting:write:meeting, meeting:update:meeting, meeting:delete:meeting and user:read:user). Add the missing ones to the app in the Zoom Marketplace, then connect again.",
    },
  };
  return messages[result] ?? null;
}

function slackMessage(result: string, detail: string | null): Message | null {
  if (result === "installed") return { tone: "ok", text: "Slack is connected. The next sync uses the app's bot." };
  const text =
    {
      cancelled: "Add to Slack was cancelled; nothing changed.",
      bad_state: "That Add to Slack expired or was started in another browser. Start it again.",
      slack_error: "Slack refused the install.",
    }[result] ?? "Add to Slack did not finish.";
  return { tone: "error", text: detail ? `${text} Slack answered ${detail}.` : text };
}

export function ConnectorsView({
  google,
  zoom,
  slack,
  returned,
}: {
  google: { configured: boolean; connection: Person | null; live: boolean; emailInvites: boolean };
  zoom: { configured: boolean; connection: Person | null };
  slack: { appConfigured: boolean; envToken: boolean; installation: SlackInstall | null; live: boolean };
  returned: Returned;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [modeBusy, setModeBusy] = useState<"google" | "slack" | "invites" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const messages = [
    returned.google && googleMessage(returned.google, returned.current),
    returned.zoom && zoomMessage(returned.zoom),
    returned.slack && slackMessage(returned.slack, returned.detail),
  ].filter((m): m is Message => Boolean(m));

  // Said once: a reload should not say it again.
  useEffect(() => {
    if (!messages.length) return;
    const url = new URL(window.location.href);
    for (const key of ["google", "zoom", "slack", "current", "detail"]) url.searchParams.delete(key);
    window.history.replaceState(null, "", url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connected = [google.connection, zoom.connection, slack.installation?.readable].filter(Boolean).length;

  async function disconnectSlack() {
    if (
      !(await confirmDialog({
        title: "Disconnect Slack?",
        description: "Syncs stop until the app is added again. The app stays installed in Slack itself.",
        confirmLabel: "Disconnect",
        destructive: true,
      }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/cohorts/slack/installation", { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (!res.ok) setError(body?.error === "not_found" ? "Slack was already disconnected." : `Could not disconnect (${res.status}).`);
      else router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  /** Turns `which` live, or back to a dry run, after saying what live does. */
  async function setMode(which: "google" | "slack", next: boolean) {
    const mode = MODES[which];
    if (next === (which === "google" ? google.live : slack.live)) return;
    if (next && !(await confirmDialog({ title: "Go live?", description: mode.confirm, confirmLabel: "Go live" }))) return;
    setModeBusy(which);
    setError(null);
    try {
      const res = await fetch(mode.route, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ live: next }),
      });
      if (!res.ok) setError(`Could not change ${mode.name}'s mode (${res.status}).`);
      else router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setModeBusy(null);
    }
  }

  /** Switches the Google Meetings sync between silent and having Google email every guest, after saying what email does. */
  async function setEmailInvites(next: boolean) {
    if (next === google.emailInvites) return;
    if (
      next &&
      !(await confirmDialog({
        title: "Email invites?",
        description:
          "From the next live Google Meetings sync, every invite change, such as adding or removing someone, is emailed by Google to everyone on that calendar event, like any edit to a meeting.",
        confirmLabel: "Email invites",
      }))
    )
      return;
    setModeBusy("invites");
    setError(null);
    try {
      const res = await fetch("/api/settings/google-meetings-invites", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: next }),
      });
      if (!res.ok) setError(`Could not change how Google Meetings invites are sent (${res.status}).`);
      else router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setModeBusy(null);
    }
  }

  const { installation } = slack;

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">External Connectors</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">{connected} of 3 connected</span>. Sign in to each with its service account,
          svc_harnessevents@harness.io.
        </p>
      </motion.div>

      {messages.map((m) => (
        <motion.p
          key={m.text}
          variants={riseChild}
          role={m.tone === "error" ? "alert" : "status"}
          className={cn("text-sm", m.tone === "error" ? "text-destructive" : "text-muted-foreground")}
        >
          {m.text}
        </motion.p>
      ))}
      {error && (
        <motion.p variants={riseChild} role="alert" className="text-sm text-destructive">
          {error}
        </motion.p>
      )}

      <motion.div variants={riseChild} className="divide-y overflow-hidden rounded-2xl border bg-card text-sm shadow-sm">
        <Row
          name="Google account"
          connected={Boolean(google.connection)}
          detail={
            google.connection
              ? `${google.connection.email}, connected ${formatWhen(google.connection.connectedAt)}${google.connection.connectedBy ? ` by ${google.connection.connectedBy}` : ""}. Google Meetings adds the cohort to the Revenue Enablement calendar's meetings as this account.`
              : google.configured
                ? "None yet. Sign in as an account that can make changes to events on the Revenue Enablement calendar."
                : "Google OAuth is not set up here."
          }
          extra={
            <>
              <ModeSwitch
                name="Google Meetings"
                live={google.live}
                busy={modeBusy === "google"}
                onChange={(next) => void setMode("google", next)}
                detail={
                  google.live
                    ? "The Google Meetings sync adds the cohort to calendar invites, takes off anyone it invited who no longer belongs, and cancels the old form's meetings and their Zoom meetings."
                    : "The Google Meetings sync reads the calendar and Zoom and logs whom it would invite and take off, without changing any invite."
                }
              />
              <ModeSwitch
                name="Google Meetings invites"
                live={google.emailInvites}
                labels={["Silent", "Email Invites"]}
                busy={modeBusy === "invites"}
                onChange={(next) => void setEmailInvites(next)}
                detail={
                  google.emailInvites
                    ? "Google emails everyone on a calendar event about each change the sync makes to its invite."
                    : "Guests find an invite on their calendar without an email."
                }
              />
            </>
          }
          action={
            google.configured && (
              // A full page load, not a client navigation: the route sends the browser on to Google.
              <Button
                variant={google.connection ? "outline" : "brand"}
                size="sm"
                onClick={() => window.location.assign("/api/evals/google-meetings/connect")}
              >
                <Plug />
                {google.connection ? "Reconnect" : "Connect Google account"}
              </Button>
            )
          }
        />
        <Row
          name="Zoom user"
          connected={Boolean(zoom.connection)}
          detail={
            zoom.connection
              ? `${zoom.connection.email}, connected ${formatWhen(zoom.connection.connectedAt)}${zoom.connection.connectedBy ? ` by ${zoom.connection.connectedBy}` : ""}. Google Meetings holds each meeting in a Zoom meeting this user hosts, with the meeting facilitators as its hosts, and reads who joined it.`
              : zoom.configured
                ? "None yet, so attendance is only what an administrator marks. Sign in as the user who hosts the meetings."
                : "Zoom is not set up here, so attendance is only what an administrator marks."
          }
          action={
            zoom.configured && (
              <Button
                variant={zoom.connection ? "outline" : "brand"}
                size="sm"
                onClick={() => window.location.assign("/api/evals/google-meetings/zoom/connect")}
              >
                <Plug />
                {zoom.connection ? "Reconnect" : "Connect Zoom user"}
              </Button>
            )
          }
        />
        <Row
          name="Slack app"
          badge={
            installation?.readable ? (
              <Badge>Connected</Badge>
            ) : installation ? (
              <Badge variant="destructive">Add again</Badge>
            ) : (
              <Badge variant="secondary">{slack.envToken ? "Deployment token" : "Not connected"}</Badge>
            )
          }
          detail={
            installation
              ? `${installation.teamName ?? installation.teamId}, added by ${installation.installedBy ?? "someone since removed"} on ${formatWhen(installation.installedAt)}. The cohort Slack sync acts as its bot.`
              : slack.envToken
                ? "The sync uses the deployment's SLACK_BOT_TOKEN until the app is added."
                : slack.appConfigured
                  ? "Add the app so the cohort Slack sync can read and change the cohort channels."
                  : "No Slack app is configured. Set slack_app_client_id and slack_app_client_secret on the Harness workspace, then redeploy."
          }
          warning={
            installation && !installation.readable
              ? "This deployment cannot open the saved token, which another deployment sealed. Add the app again."
              : installation?.missingScopes.length
                ? `Missing ${installation.missingScopes.join(", ")}. Add it again to grant them.`
                : null
          }
          extra={
            <ModeSwitch
              name="Slack"
              live={slack.live}
              busy={modeBusy === "slack"}
              onChange={(next) => void setMode("slack", next)}
              detail={
                slack.live
                  ? "The app changes Slack and sends its messages: the cohort sync and reminders, survey announcements, Live Sessions channels and release messages."
                  : "Nothing is changed or sent in Slack. The cohort sync and releases log what they would do; the Live Sessions Slack button does nothing."
              }
            />
          }
          action={
            <>
              {slack.appConfigured && (
                <Button asChild size="sm" variant={installation?.readable ? "outline" : "brand"}>
                  {/* A plain link: the install leaves for slack.com and comes back through the callback. */}
                  <a href="/api/cohorts/slack/install">
                    <Plug />
                    {installation ? "Add again" : "Add to Slack"}
                  </a>
                </Button>
              )}
              {installation && (
                <Button variant="outline" size="sm" disabled={busy} onClick={disconnectSlack}>
                  {busy ? <Loader2 className="animate-spin" /> : <Unplug />}
                  Disconnect
                </Button>
              )}
            </>
          }
        />
      </motion.div>
    </motion.div>
  );
}

const MODES = {
  google: {
    name: "Google Meetings",
    route: "/api/settings/google-meetings-mode",
    confirm:
      "From the next Google Meetings sync, calendar invites go to the cohort and the meeting facilitators, those it invited who no longer belong are taken off, and any meetings left from the old form are cancelled.",
  },
  slack: {
    name: "Slack",
    route: "/api/settings/slack-mode",
    confirm:
      "From now on the cohort Slack sync creates channels, invites and removes people and sends reminders; the daily surveys are announced; the Live Sessions Slack button opens channels; and releasing scores messages managers.",
  },
} as const;

/** A connector's Dry run / Live switch, or another two-way one by `labels`, with what the mode it is in does. */
function ModeSwitch({
  name,
  live,
  busy,
  onChange,
  detail,
  labels = ["Dry run", "Live"],
}: {
  name: string;
  live: boolean;
  /** The off and on labels. */
  labels?: readonly [string, string];
  busy: boolean;
  onChange: (live: boolean) => void;
  detail: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 pt-2">
      <div
        role="radiogroup"
        aria-label={`${name} mode`}
        className="inline-flex shrink-0 items-center rounded-lg border bg-card p-0.5 shadow-xs"
      >
        {(
          [
            [false, labels[0]],
            [true, labels[1]],
          ] as const
        ).map(([value, label]) => (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={live === value}
            disabled={busy}
            onClick={() => onChange(value)}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-wait",
              live === value
                ? value
                  ? "bg-brand font-medium text-brand-foreground"
                  : "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {busy && live !== value && <Loader2 className="size-3.5 animate-spin" />}
            {label}
          </button>
        ))}
      </div>
      <span className="text-muted-foreground">{detail}</span>
    </div>
  );
}

function Row({
  name,
  connected,
  badge,
  detail,
  warning,
  extra,
  action,
}: {
  name: string;
  connected?: boolean;
  badge?: React.ReactNode;
  detail: string;
  warning?: string | null;
  /** Settings of the connector's own, under its detail. */
  extra?: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-0.5">
        <div className="flex items-center gap-2 font-medium">
          {name}
          {badge ?? (connected ? <Badge>Connected</Badge> : <Badge variant="secondary">Not connected</Badge>)}
        </div>
        <div className="text-muted-foreground">{detail}</div>
        {warning && (
          <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-3.5 shrink-0" />
            {warning}
          </div>
        )}
        {extra}
      </div>
      <div className="flex flex-wrap gap-2">{action}</div>
    </div>
  );
}
