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
import { ArrowLeft, Check, Copy, ExternalLink } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { riseChild, staggerParent } from "@/lib/motion";
import { RunConfig } from "./run-config";

type RunPayload = {
  run: WorkshopRun;
  logs: RunLog[];
  accounts: WorkshopAccount[];
};

const TERMINAL = new Set(["ready", "destroyed", "failed"]);
// Poll only while the run is actively moving; scheduled/terminal runs are static.
const ACTIVE = new Set(["requested", "provisioning", "applying", "destroying"]);

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

export function RunView({ initial, runId }: { initial: RunPayload; runId: string }) {
  const [data, setData] = useState<RunPayload>(initial);
  const logEndRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
    if (res.ok) setData(await res.json());
  }, [runId]);

  useEffect(() => {
    if (!ACTIVE.has(data.run.status)) return;
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [data.run.status, refresh]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [data.logs.length]);

  const { run, logs, accounts } = data;
  const outputs = run.outputs as Record<string, unknown> | null;

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
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {run.orgUnitPath && <MetaChip>{run.orgUnitPath}</MetaChip>}
              {run.gcpProjectId && <MetaChip>{run.gcpProjectId}</MetaChip>}
              {run.expiresAt && !TERMINAL.has(run.status) && (
                <MetaChip>
                  Expires {new Date(run.expiresAt).toLocaleTimeString()}
                </MetaChip>
              )}
            </div>
          </div>
          <StatusBadge status={run.status} />
        </div>
      </motion.div>

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
              Each user is prompted to change their password at first sign-in.
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
