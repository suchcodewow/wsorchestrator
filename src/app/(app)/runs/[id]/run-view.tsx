"use client";

import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RunLog, WorkshopRun } from "@/db/schema";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type RunPayload = { run: WorkshopRun; logs: RunLog[] };

const TERMINAL = new Set(["ready", "destroyed", "failed"]);
// Poll only while the run is actively moving; scheduled/terminal runs are static.
const ACTIVE = new Set(["requested", "provisioning", "applying", "destroying"]);

export function RunView({ initial, runId }: { initial: RunPayload; runId: string }) {
  const [data, setData] = useState<RunPayload>(initial);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ACTIVE.has(data.run.status)) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
      if (res.ok) setData(await res.json());
    }, 2500);
    return () => clearInterval(timer);
  }, [data.run.status, runId]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [data.logs.length]);

  const { run, logs } = data;
  const outputs = run.outputs as Record<string, unknown> | null;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/workshops"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to library
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{run.name ?? run.gcpProjectId ?? `run ${run.id.slice(0, 8)}`}</h1>
            {run.status === "scheduled" && run.scheduledStart && (
              <p className="text-sm text-muted-foreground">Scheduled for {new Date(run.scheduledStart).toLocaleString()}</p>
            )}
            {run.gcpProjectId && run.name && <p className="font-mono text-sm text-muted-foreground">{run.gcpProjectId}</p>}
            {run.expiresAt && !TERMINAL.has(run.status) && (
              <p className="text-sm text-muted-foreground">Expires {new Date(run.expiresAt).toLocaleTimeString()}</p>
            )}
          </div>
          <StatusBadge status={run.status} />
        </div>
      </div>

      {run.error && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">{run.error}</CardContent>
        </Card>
      )}

      {outputs && Object.keys(outputs).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Outputs</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {Object.entries(outputs).map(([k, v]) => (
              <div key={k} className="flex gap-3">
                <span className="w-40 shrink-0 text-muted-foreground">{k}</span>
                <span className="font-mono break-all">{String(v)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Build log</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-112 overflow-auto rounded-md bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-200">
            {logs.length === 0 && <span className="text-slate-500">Waiting for output…</span>}
            {logs.map((l) => (
              <div key={l.id} className={l.stream === "stderr" ? "text-red-400" : l.stream === "system" ? "text-sky-400" : ""}>
                <span className="mr-2 text-slate-600">{new Date(l.ts).toLocaleTimeString()}</span>
                {l.message}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
