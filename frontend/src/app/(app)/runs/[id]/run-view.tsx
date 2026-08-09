"use client";

import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CLOUD_LABELS,
  editabilityOf,
  type RunLog,
  type WorkshopAccount,
  type WorkshopRun,
} from "@/db/schema";
import { ArrowLeft, Check, Copy, ExternalLink, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { riseChild, staggerParent } from "@/lib/motion";
import { DeleteEventButton } from "./delete-event-button";
import { ExtendEventButton } from "./extend-event-button";
import { RetryEventButton } from "./retry-event-button";
import { RunConfig } from "./run-config";

type RunPayload = {
  run: WorkshopRun;
  logs: RunLog[];
  accounts: WorkshopAccount[];
  /** Who booked it. Null only if the account has since been removed. */
  owner: { id: string; name: string | null; email: string | null } | null;
};

// Poll only while the run is actively moving; scheduled/terminal runs are static.
const ACTIVE = new Set(["requested", "provisioning", "applying", "destroying"]);

/**
 * When the event's cloud resources go away, in the words the page should use.
 *
 * `projected` — it hasn't started yet, so the moment is start + lifetime and
 *   only an estimate; it firms up to `expiresAt` once the build goes ready.
 * A failed run was expired on the spot purely so the reaper cleans up its
 * half-built resources — that isn't a teardown worth advertising, so it's left
 * out.
 */
/** A lifetime in seconds as the largest whole unit it divides into evenly. */
function humanDuration(seconds: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (seconds % 86400 === 0) return plural(seconds / 86400, "day");
  if (seconds % 3600 === 0) return plural(seconds / 3600, "hour");
  return plural(Math.round(seconds / 60), "minute");
}

function destroyMoment(
  run: WorkshopRun,
): { label: string; when: Date; projected: boolean } | null {
  if (run.status === "failed") return null;
  if (run.status === "destroyed") {
    return run.destroyedAt
      ? { label: "Destroyed", when: new Date(run.destroyedAt), projected: false }
      : null;
  }
  if (run.expiresAt) {
    return { label: "Destroys", when: new Date(run.expiresAt), projected: false };
  }
  if (run.scheduledStart) {
    return {
      label: "Destroys",
      when: new Date(
        new Date(run.scheduledStart).getTime() + run.ttlSeconds * 1000,
      ),
      projected: true,
    };
  }
  return null;
}

/**
 * Render one Terraform output. A challenge's per-competitor outputs are maps
 * of address -> value, which `String(v)` would flatten to "[object Object]".
 */
function OutputValue({ value }: { value: unknown }) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return (
      <div className="grid gap-1">
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <div key={k} className="flex flex-wrap gap-2">
            <span className="font-mono text-xs text-muted-foreground">{k}</span>
            <span className="font-mono break-all">{String(v)}</span>
          </div>
        ))}
      </div>
    );
  }
  return <span className="font-mono break-all">{String(value)}</span>;
}

export function RunView({
  initial,
  runId,
  viewerId,
}: {
  initial: RunPayload;
  runId: string;
  /** Whose session this is — decides whether the event reads as theirs. */
  viewerId: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<RunPayload>(initial);
  const logEndRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
    if (res.ok) {
      setData(await res.json());
      return;
    }
    // Gone — its teardown finished, or a manager deleted it out from under
    // this tab. Either way there is nothing left here to poll.
    if (res.status === 404) router.replace("/events");
  }, [runId, router]);

  // Poll while the run is moving, or awaiting deletion (which may sit in
  // `ready` for a few minutes while the reaper finishes). A scheduled run is
  // also polled once its start time is at hand, so the scheduler's "picked up"
  // line and the first build output appear live rather than only on a reload —
  // the page would otherwise sit still through the whole hand-off.
  const { status, scheduledStart, deleteRequested } = data.run;
  useEffect(() => {
    if (ACTIVE.has(status) || deleteRequested) {
      const timer = setInterval(refresh, 2500);
      return () => clearInterval(timer);
    }

    if (status === "scheduled" && scheduledStart) {
      const lead = new Date(scheduledStart).getTime() - Date.now();
      // Leave runs scheduled far out alone — a reload will pick them up; only
      // watch ones starting within the next 12 hours.
      if (lead > 12 * 60 * 60 * 1000) return;
      let interval: ReturnType<typeof setInterval>;
      // Start polling at the start time (or now, if it has already passed) and
      // keep going until the scheduler flips it to `requested`, at which point
      // this effect re-runs into the ACTIVE branch above.
      const start = setTimeout(() => {
        void refresh();
        interval = setInterval(refresh, 3000);
      }, Math.max(0, lead));
      return () => {
        clearTimeout(start);
        clearInterval(interval);
      };
    }
  }, [status, scheduledStart, deleteRequested, refresh]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [data.logs.length]);

  const { run, logs, accounts, owner } = data;
  // Azure issues one per attendee; nothing else does, so the column only earns
  // its width on an event that selected Azure.
  const hasAccessPass = accounts.some((a) => a.azureAccessPass);
  const outputs = run.outputs as Record<string, unknown> | null;
  const owned = run.userId === viewerId;
  const destroy = destroyMoment(run);

  return (
    <motion.div
      variants={staggerParent(0.05)}
      initial="hidden"
      animate="show"
      className="space-y-6"
    >
      <motion.div variants={riseChild}>
        <Link
          href="/events"
          className="group mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
          Back to events
        </Link>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-medium tracking-tight">{run.name}</h1>
            <p className="text-sm text-muted-foreground">
              <span className="capitalize">{run.mode}</span>
              {" · "}
              {run.userCount} user{run.userCount === 1 ? "" : "s"}
              {run.clouds.length > 0 &&
                ` · ${run.clouds.map((c) => CLOUD_LABELS[c]).join(", ")}`}
            </p>
            {run.status === "scheduled" && run.scheduledStart && (
              <p className="text-sm text-muted-foreground">
                Scheduled for {new Date(run.scheduledStart).toLocaleString()}
              </p>
            )}
            {destroy && (
              <p className="text-sm text-muted-foreground">
                {destroy.projected ? "Destroys around " : `${destroy.label} `}
                <span className="font-medium text-foreground">
                  {destroy.when.toLocaleString()}
                </span>
                {destroy.projected && (
                  <span className="text-muted-foreground">
                    {" "}
                    — {humanDuration(run.ttlSeconds)} after it starts
                  </span>
                )}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {/* Whose event this is, but only when that isn't the obvious
                  answer — a manager arrives here from the all-users view. */}
              {!owned && owner && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                  <User className="size-3" />
                  {owner.name ?? owner.email}
                </span>
              )}
              {run.orgUnitPath && <MetaChip>{run.orgUnitPath}</MetaChip>}
              {run.gcpProjectId && <MetaChip>{run.gcpProjectId}</MetaChip>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusBadge status={run.status} />
            <RetryEventButton run={run} onRetried={refresh} />
            <ExtendEventButton run={run} onExtended={refresh} />
            <DeleteEventButton run={run} owned={owned} onRequested={refresh} />
          </div>
        </div>
      </motion.div>

      {run.deleteRequested && (
        <motion.div variants={riseChild}>
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardContent className="py-4 text-sm">
              Deletion requested. This event is being torn down and disappears
              once that finishes — the reaper picks it up within a few minutes.
            </CardContent>
          </Card>
        </motion.div>
      )}

      {run.error && (
        <motion.div variants={riseChild}>
          <Card className="border-destructive/40 bg-destructive/5">
            <CardHeader>
              <CardTitle className="text-destructive">Error</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">{run.error}</CardContent>
          </Card>
        </motion.div>
      )}

      {outputs && Object.keys(outputs).length > 0 && (
        <motion.div variants={riseChild}>
          <Card>
            <CardHeader>
              <CardTitle>Outputs</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2.5 text-sm">
              {Object.entries(outputs).map(([k, v]) => (
                <div key={k} className="flex gap-3">
                  <span className="w-40 shrink-0 text-muted-foreground">
                    {k}
                  </span>
                  <OutputValue value={v} />
                </div>
              ))}
            </CardContent>
          </Card>
        </motion.div>
      )}

      <motion.div variants={riseChild}>
        <RunConfig
          run={run}
          editability={editabilityOf(run.status)}
          onSaved={refresh}
        />
      </motion.div>

      {accounts.length > 0 && (
        <motion.div variants={riseChild}>
          <AttendeeLink runId={run.id} mode={run.mode} />
        </motion.div>
      )}

      {accounts.length > 0 && (
        <motion.div variants={riseChild}>
        <Card>
          <CardHeader>
            <CardTitle>
              {run.mode === "challenge" ? "Competitor" : "Attendee"} accounts (
              {accounts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="pb-2 font-medium">Email</th>
                    <th className="pb-2 font-medium">Temporary password</th>
                    {/* Only for an event that provisioned Azure, which is the
                        only thing that issues one. */}
                    {hasAccessPass && (
                      <th className="pb-2 font-medium">Azure access pass</th>
                    )}
                    <th className="pb-2 font-medium">Claimed by</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {accounts.map((a) => (
                    <tr
                      key={a.id}
                      className="border-t transition-colors hover:bg-muted/40"
                    >
                      <td className="py-2 pr-4 break-all">{a.email}</td>
                      <td className="py-2 pr-4">{a.tempPassword}</td>
                      {hasAccessPass && (
                        <td className="py-2 pr-4">
                          {a.azureAccessPass ?? (
                            <span className="font-sans text-muted-foreground">
                              none
                            </span>
                          )}
                        </td>
                      )}
                      {/* Filled in by the attendee on the shared page below. */}
                      <td className="py-2 font-sans">
                        {a.claimedName ?? (
                          <span className="text-muted-foreground">
                            unclaimed
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {/* Not "prompted to change their password": accounts are created
                  without a forced reset so the one password works across every
                  cloud the event uses. */}
              The password is the same one in every cloud this {run.mode} uses.
              {hasAccessPass &&
                " Azure asks for the access pass instead — Microsoft requires MFA on portal sign-in, and the pass satisfies it without an authenticator app."}{" "}
              Accounts are deleted when the {run.mode} expires.
            </p>
          </CardContent>
        </Card>
        </motion.div>
      )}

      <motion.div variants={riseChild}>
      <Card>
        <CardHeader>
          <CardTitle>Build log</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-112 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-200">
            {logs.length === 0 && (
              <span className="text-slate-500">Waiting for output…</span>
            )}
            {logs.map((l) => (
              <motion.div
                key={l.id}
                // New lines fade in as they stream, so the eye is drawn to what
                // just arrived rather than to the whole block reflowing.
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                className={cn(
                  "flex gap-3",
                  l.stream === "stderr"
                    ? "text-red-400"
                    : l.stream === "system"
                      ? "text-sky-400"
                      : "",
                )}
              >
                <span className="shrink-0 text-slate-600 tnum">
                  {new Date(l.ts).toLocaleTimeString()}
                </span>
                <span className="break-all">{l.message}</span>
              </motion.div>
            ))}
            <div ref={logEndRef} />
          </div>
        </CardContent>
      </Card>
      </motion.div>
    </motion.div>
  );
}

/**
 * The shareable page the room uses to pick up their credentials.
 *
 * The path is rendered rather than the full URL because the origin is only
 * knowable in the browser, and reading it during render would not match what
 * the server sent. Copy resolves it against the current origin instead, so the
 * clipboard still gets something an attendee can paste into a phone.
 */
function AttendeeLink({ runId, mode }: { runId: string; mode: string }) {
  const [copied, setCopied] = useState(false);
  const path = `/attend/${runId}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(new URL(path, location.origin).href);
    } catch {
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Attendee page</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Share this link with the room. Everyone who opens it sees the accounts
          below and claims one by putting their name on it.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">
            {path}
          </code>
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? <Check className="text-emerald-600" /> : <Copy />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={path} target="_blank" rel="noreferrer">
              Open
              <ExternalLink />
            </Link>
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Anyone with the link can see these credentials — it is not behind a
          sign-in, because attendees have no account here yet. The link stops
          working when the {mode} is torn down.
        </p>
      </CardContent>
    </Card>
  );
}

/** A small monospace fact — org unit path, project id, expiry. */
function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
      {children}
    </span>
  );
}
