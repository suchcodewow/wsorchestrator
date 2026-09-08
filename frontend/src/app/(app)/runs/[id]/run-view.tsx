"use client";

/** One event: its status, credentials, resources and log. */

import { StatusBadge } from "@/components/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CLOUD_LABELS,
  editabilityOf,
  type RunLog,
  type RunResource,
  type WorkshopAccount,
  type WorkshopRun,
} from "@/db/schema";
import {
  ArrowLeft,
  Boxes,
  Building2,
  Check,
  ChevronDown,
  CircleCheck,
  Cloud,
  Copy,
  ExternalLink,
  FileCode,
  FolderKanban,
  KeyRound,
  Layers,
  Loader2,
  Network,
  Plug,
  Server,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { riseChild, staggerParent } from "@/lib/motion";
import { DeleteEventButton } from "./delete-event-button";
import { EndNowButton } from "./end-now-button";
import { ExtendEventButton } from "./extend-event-button";
import { RetryEventButton } from "./retry-event-button";
import { RetryTeardownButton } from "./retry-teardown-button";
import { RunConfig } from "./run-config";

type RunPayload = {
  run: WorkshopRun;
  logs: RunLog[];
  accounts: WorkshopAccount[];
  resources: RunResource[];
  owner: { id: string; name: string | null; email: string | null } | null;
};

const ACTIVE = new Set(["requested", "provisioning", "applying", "destroying"]);

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
    const when = new Date(run.expiresAt);
    // Already past: the end time has arrived (or was brought forward by "End
    // now") and the reaper has yet to tick, so future tense would be wrong.
    return {
      label: when <= new Date() ? "Ended" : "Destroys",
      when,
      projected: false,
    };
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
  viewerId: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<RunPayload>(initial);
  const logBoxRef = useRef<HTMLDivElement>(null);
  const [tail, setTail] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);
  const [showOutputs, setShowOutputs] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
    if (res.ok) {
      setData(await res.json());
      return;
    }
    if (res.status === 404) router.replace("/events");
  }, [runId, router]);

  const { status, scheduledStart, deleteRequested, expiresAt } = data.run;
  const overdue =
    status === "ready" && expiresAt !== null && new Date(expiresAt) <= new Date();
  useEffect(() => {
    if (ACTIVE.has(status) || deleteRequested) {
      const timer = setInterval(refresh, 2500);
      return () => clearInterval(timer);
    }

    // Past its end time but still `ready`: the reaper has not picked it up yet.
    // Polled slower than a live build, since that wait is a scheduler tick long,
    // and it is how ending an event early shows up here without a reload.
    if (overdue) {
      const timer = setInterval(refresh, 10_000);
      return () => clearInterval(timer);
    }

    if (status === "scheduled" && scheduledStart) {
      const lead = new Date(scheduledStart).getTime() - Date.now();
      if (lead > 12 * 60 * 60 * 1000) return;
      let interval: ReturnType<typeof setInterval>;
      const start = setTimeout(() => {
        void refresh();
        interval = setInterval(refresh, 3000);
      }, Math.max(0, lead));
      return () => {
        clearTimeout(start);
        clearInterval(interval);
      };
    }
  }, [status, scheduledStart, deleteRequested, overdue, refresh]);

  useEffect(() => {
    if (!tail) return;
    const box = logBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [tail, data.logs.length]);

  const { run, logs, accounts, resources, owner } = data;
  const hasAccessPass = accounts.some((a) => a.azureAccessPass);
  const claimed = accounts.filter((a) => a.claimedAt).length;
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
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
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
            {overdue && (
              <p className="text-sm text-muted-foreground">
                Teardown starts within a few minutes.
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
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
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <StatusBadge status={run.status} />
            <RetryEventButton run={run} onRetried={refresh} />
            <RetryTeardownButton run={run} onRetried={refresh} />
            <ExtendEventButton run={run} onExtended={refresh} />
            <EndNowButton run={run} owned={owned} onEnded={refresh} />
            <DeleteEventButton run={run} owned={owned} onRequested={refresh} />
          </div>
        </div>
      </motion.div>

      {run.deleteRequested && run.status !== "destroy_failed" && (
        <motion.div variants={riseChild}>
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardContent className="py-4 text-sm">
              Deletion requested — this event is being torn down and will
              disappear in a few minutes.
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
            <CardContent className="text-sm whitespace-pre-line">
              {run.error}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {accounts.length > 0 && (
        <motion.div variants={riseChild}>
          <AttendeeLink runId={run.id} mode={run.mode} />
        </motion.div>
      )}

      {(resources.length > 0 || ACTIVE.has(run.status)) && (
        <motion.div variants={riseChild}>
          <BuiltPanel run={run} resources={resources} />
        </motion.div>
      )}

      {outputs && Object.keys(outputs).length > 0 && (
        <motion.div variants={riseChild}>
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div className="grid gap-1.5">
                <CardTitle>Raw outputs</CardTitle>
                <CardDescription>
                  Every value Terraform returned, as it returned it.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowOutputs((on) => !on)}
                aria-expanded={showOutputs}
              >
                {showOutputs ? "Hide" : "Show"} outputs
                <ChevronDown
                  className={cn(
                    "transition-transform duration-200",
                    showOutputs && "rotate-180",
                  )}
                />
              </Button>
            </CardHeader>
            {showOutputs && (
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
            )}
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
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div className="grid gap-1.5">
              <CardTitle>
                {run.mode === "challenge" ? "Competitor" : "Attendee"} accounts
              </CardTitle>
              <CardDescription>
                {accounts.length} of {run.userCount} created
                {claimed > 0 && ` · ${claimed} claimed`}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCredentials((on) => !on)}
              aria-expanded={showCredentials}
            >
              {showCredentials ? "Hide" : "Show"} credentials
              <ChevronDown
                className={cn(
                  "transition-transform duration-200",
                  showCredentials && "rotate-180",
                )}
              />
            </Button>
          </CardHeader>
          {showCredentials && (
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="pb-2 font-medium">Email</th>
                    <th className="pb-2 font-medium">Temporary password</th>
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
              This password works in every cloud except AWS, which generates its
              own on the attendee page
              {hasAccessPass && ", and Azure, which asks for the access pass"}.
            </p>
          </CardContent>
          )}
        </Card>
        </motion.div>
      )}

      <motion.div variants={riseChild}>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Build log</CardTitle>
          <button
            type="button"
            role="switch"
            aria-checked={tail}
            onClick={() => setTail((on) => !on)}
            className="group inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Follow
            <span
              className={cn(
                "relative h-5 w-9 rounded-full transition-colors",
                tail ? "bg-brand" : "bg-input",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-4 rounded-full bg-white shadow-xs transition-all",
                  tail ? "left-4.5" : "left-0.5",
                )}
              />
            </span>
          </button>
        </CardHeader>
        <CardContent>
          <div
            ref={logBoxRef}
            className="max-h-112 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-200"
          >
            {logs.length === 0 && (
              <span className="text-slate-500">Waiting for output…</span>
            )}
            {logs.map((l) => (
              <motion.div
                key={l.id}
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
          </div>
        </CardContent>
      </Card>
      </motion.div>
    </motion.div>
  );
}

const RESOURCE_ICONS: Record<string, LucideIcon> = {
  org_unit: Building2,
  accounts: Users,
  harness_org: Layers,
  harness_projects: FolderKanban,
  gcp_project: Cloud,
  azure_resource_group: Cloud,
  aws_account: Cloud,
  gke_cluster: Server,
  aks_cluster: Server,
  eks_cluster: Server,
  harness_delegate: Network,
  harness_connector: Plug,
  harness_secret: KeyRound,
  harness_template: FileCode,
  harness_components: Boxes,
};

function BuiltPanel({
  run,
  resources,
}: {
  run: WorkshopRun;
  resources: RunResource[];
}) {
  const building = ACTIVE.has(run.status) && run.status !== "destroying";
  const teardownGaveUp = run.status === "destroy_failed";
  const tearingDown =
    !teardownGaveUp && (run.status === "destroying" || run.deleteRequested);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{building ? "Building" : "Environment"}</CardTitle>
        <CardDescription>
          {teardownGaveUp
            ? "Teardown stopped early, so anything listed here may still exist."
            : tearingDown
              ? "Being torn down — these disappear as they are removed."
              : building
                ? "Each item appears here as soon as it exists."
                : `Everything this ${run.mode} created.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {resources.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing built yet — the first items appear within a minute.
          </p>
        ) : (
          <ul className="grid gap-2">
            <AnimatePresence initial={false}>
              {resources.map((r) => (
                <ResourceRow key={r.id} resource={r} />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ResourceRow({ resource }: { resource: RunResource }) {
  const Icon = RESOURCE_ICONS[resource.kind] ?? Boxes;
  const { done, total } = resource;
  const counted = done !== null && total !== null;
  const pending = counted && done < total;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{resource.label}</div>
        {resource.detail && (
          <div className="truncate font-mono text-xs text-muted-foreground">
            {resource.detail}
          </div>
        )}
      </div>

      {counted && (
        <span
          className={cn(
            "shrink-0 text-sm tnum",
            pending ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {done}
          <span className="text-muted-foreground">/{total}</span>
        </span>
      )}

      {resource.url && (
        <Button variant="ghost" size="sm" asChild>
          <Link href={resource.url} target="_blank" rel="noreferrer">
            Open
            <ExternalLink />
          </Link>
        </Button>
      )}

      {pending ? (
        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <CircleCheck className="size-4 shrink-0 text-emerald-600" />
      )}
    </motion.li>
  );
}

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
          Share this link with the room to let attendees claim an account.
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
          This link is available to anyone and will be removed when the {mode}{" "}
          ends.
        </p>
      </CardContent>
    </Card>
  );
}

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
      {children}
    </span>
  );
}
