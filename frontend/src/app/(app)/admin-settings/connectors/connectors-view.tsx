"use client";

/**
 * External Connectors: each outside account the app acts as, in one card. A
 * connect button leaves for the provider's consent screen and comes back
 * through the shared OAuth callback (lib/oauth-purposes.ts), which reports the
 * outcome in the query string.
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
    connected: { tone: "ok", text: "Google is connected. Sync Now sends the invites from this account." },
    denied: { tone: "error", text: "Google was not given access, so nothing changed." },
    expired: { tone: "error", text: "That sign-in took too long or started in another tab. Connect again." },
    failed: { tone: "error", text: "Google did not finish connecting. Connect again." },
    scope: { tone: "error", text: "The account was connected without calendar access. Connect again and allow it." },
    different_account: {
      tone: "error",
      text: `Meetings already have invites from ${current ?? "the connected account"}. Connect that account again, or delete those meetings first.`,
    },
  };
  return messages[result] ?? null;
}

function zoomMessage(result: string): Message | null {
  const messages: Record<string, Message> = {
    connected: { tone: "ok", text: "Zoom is connected. Sync Now makes each Zoom meeting as this user." },
    denied: { tone: "error", text: "Zoom was not given access, so nothing changed." },
    expired: { tone: "error", text: "That sign-in took too long or started in another tab. Connect again." },
    failed: { tone: "error", text: "Zoom did not finish connecting. Connect again." },
    scope: {
      tone: "error",
      text: "Zoom did not grant every scope the app needs (the meeting scopes and user:read:user). Add the missing ones to the app in the Zoom Marketplace, then connect again.",
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
  google: { configured: boolean; connection: Person | null };
  zoom: { configured: boolean; connection: Person | null };
  slack: { appConfigured: boolean; envToken: boolean; installation: SlackInstall | null };
  returned: Returned;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
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
    if (!window.confirm("Disconnect Slack? Syncs stop until the app is added again. The app stays installed in Slack itself.")) return;
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

  const { installation } = slack;

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">External Connectors</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">{connected} of 3 connected</span>. Sign in to each with its service account, svc_harnessevents@harness.io.
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
              ? `${google.connection.email}, connected ${formatWhen(google.connection.connectedAt)}${google.connection.connectedBy ? ` by ${google.connection.connectedBy}` : ""}. Google Meetings sends its invites from this account.`
              : google.configured
                ? "None yet. Sign in as the account the Google Meetings invites should come from."
                : "Google OAuth is not set up here."
          }
          action={
            google.configured && (
              // A full page load, not a client navigation: the route sends the browser on to Google.
              <Button variant={google.connection ? "outline" : "brand"} size="sm" onClick={() => window.location.assign("/api/evals/google-meetings/connect")}>
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
              ? `${zoom.connection.email}, connected ${formatWhen(zoom.connection.connectedAt)}${zoom.connection.connectedBy ? ` by ${zoom.connection.connectedBy}` : ""}. Each Google Meetings invite gets a Zoom link made as this user.`
              : zoom.configured
                ? "None yet, so invites go out with no Zoom link. Sign in as the user the Zoom meetings should be made as."
                : "Zoom is not set up here, so invites go out with no Zoom link."
          }
          action={
            zoom.configured && (
              <Button variant={zoom.connection ? "outline" : "brand"} size="sm" onClick={() => window.location.assign("/api/evals/google-meetings/zoom/connect")}>
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

function Row({
  name,
  connected,
  badge,
  detail,
  warning,
  action,
}: {
  name: string;
  connected?: boolean;
  badge?: React.ReactNode;
  detail: string;
  warning?: string | null;
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
      </div>
      <div className="flex flex-wrap gap-2">{action}</div>
    </div>
  );
}
