"use client";

/** One event: its status, credentials, resources and log. */

import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CLOUD_LABELS, editabilityOf, type RunLog, type RunResource, type WorkshopAccount, type WorkshopRun } from "@/db/schema";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
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
  Github,
  KeyRound,
  Layers,
  Library,
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

function destroyMoment(run: WorkshopRun): { label: string; when: Date; projected: boolean } | null {
  if (run.status === "failed") return null;
  if (run.status === "destroyed") {
    return run.destroyedAt ? { label: "Destroyed", when: new Date(run.destroyedAt), projected: false } : null;
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
      when: new Date(new Date(run.scheduledStart).getTime() + run.ttlSeconds * 1000),
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
  imported,
}: {
  initial: RunPayload;
  runId: string;
  viewerId: string;
  /**
   * A copy of another deployment's run, from an imported production backup.
   * Shown, but nothing on it can be changed; see `lib/deployment.ts`.
   */
  imported: boolean;
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
  const overdue = status === "ready" && expiresAt !== null && new Date(expiresAt) <= new Date();
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
      const start = setTimeout(
        () => {
          void refresh();
          interval = setInterval(refresh, 3000);
        },
        Math.max(0, lead),
      );
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
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
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
              {run.clouds.length > 0 && ` · ${run.clouds.map((c) => CLOUD_LABELS[c]).join(", ")}`}
            </p>
            {run.status === "scheduled" && run.scheduledStart && (
              <p className="text-sm text-muted-foreground">Scheduled for {new Date(run.scheduledStart).toLocaleString()}</p>
            )}
            {destroy && (
              <p className="text-sm text-muted-foreground">
                {destroy.projected ? "Destroys around " : `${destroy.label} `}
                <span className="font-medium text-foreground">{destroy.when.toLocaleString()}</span>
                {destroy.projected && <span className="text-muted-foreground"> — {humanDuration(run.ttlSeconds)} after it starts</span>}
              </p>
            )}
            {overdue && <p className="text-sm text-muted-foreground">Teardown starts within a few minutes.</p>}
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
            {!imported && (
              <>
                <RetryEventButton run={run} onRetried={refresh} />
                <RetryTeardownButton run={run} onRetried={refresh} />
                <ExtendEventButton run={run} onExtended={refresh} />
                <EndNowButton run={run} owned={owned} onEnded={refresh} />
                <DeleteEventButton run={run} owned={owned} onRequested={refresh} />
              </>
            )}
          </div>
        </div>
      </motion.div>

      {imported && (
        <motion.div variants={riseChild}>
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardContent className="py-4 text-sm">
              Imported from production. This is a read-only copy of the production event, so it cannot be changed, started or deleted here,
              and this deployment&apos;s runner never acts on it. Its attendee passwords were removed during the import.
            </CardContent>
          </Card>
        </motion.div>
      )}

      {run.deleteRequested && run.status !== "destroy_failed" && (
        <motion.div variants={riseChild}>
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardContent className="py-4 text-sm">
              Deletion requested — this event is being torn down and will disappear in a few minutes.
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
            <CardContent className="text-sm whitespace-pre-line">{run.error}</CardContent>
          </Card>
        </motion.div>
      )}

      <motion.div
        variants={staggerParent(0.04)}
        className="divide-y overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-sm"
      >
        {accounts.length > 0 && <AttendeeLink runId={run.id} mode={run.mode} />}

        {(resources.length > 0 || ACTIVE.has(run.status)) && <BuiltPanel run={run} resources={resources} />}

        {outputs && Object.keys(outputs).length > 0 && (
          <Panel
            title="Raw outputs"
            action={
              <Button variant="outline" size="sm" onClick={() => setShowOutputs((on) => !on)} aria-expanded={showOutputs}>
                {showOutputs ? "Hide" : "Show"} outputs
                <ChevronDown className={cn("transition-transform duration-200", showOutputs && "rotate-180")} />
              </Button>
            }
          >
            {showOutputs && (
              <div className="grid gap-2.5 text-sm">
                {Object.entries(outputs).map(([k, v]) => (
                  <div key={k} className="flex gap-3">
                    <span className="w-40 shrink-0 text-muted-foreground">{k}</span>
                    <OutputValue value={v} />
                  </div>
                ))}
              </div>
            )}
          </Panel>
        )}

        <Panel title="Configuration">
          <RunConfig run={run} editability={imported ? "locked" : editabilityOf(run.status)} onSaved={refresh} />
        </Panel>

        {accounts.length > 0 && (
          <Panel
            title={`${run.mode === "challenge" ? "Competitor" : "Attendee"} accounts`}
            description={
              <>
                {accounts.length} of {run.userCount} created
                {claimed > 0 && ` · ${claimed} claimed`}
              </>
            }
            action={
              <Button variant="outline" size="sm" onClick={() => setShowCredentials((on) => !on)} aria-expanded={showCredentials}>
                {showCredentials ? "Hide" : "Show"} credentials
                <ChevronDown className={cn("transition-transform duration-200", showCredentials && "rotate-180")} />
              </Button>
            }
          >
            {showCredentials && (
              <div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="pb-2 font-medium">Email</th>
                        <th className="pb-2 font-medium">Temporary password</th>
                        {hasAccessPass && <th className="pb-2 font-medium">Azure access pass</th>}
                        <th className="pb-2 font-medium">Claimed by</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {accounts.map((a) => (
                        <tr key={a.id} className="border-t transition-colors hover:bg-muted/40">
                          <td className="py-2 pr-4 break-all">{a.email}</td>
                          <td className="py-2 pr-4">{a.tempPassword}</td>
                          {hasAccessPass && (
                            <td className="py-2 pr-4">
                              {a.azureAccessPass ?? <span className="font-sans text-muted-foreground">none</span>}
                            </td>
                          )}
                          <td className="py-2 font-sans">{a.claimedName ?? <span className="text-muted-foreground">unclaimed</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  This password works in every cloud except AWS, which generates its own on the attendee page
                  {hasAccessPass && ", and Azure, which asks for the access pass"}.
                </p>
              </div>
            )}
          </Panel>
        )}

        <Panel
          title="Build log"
          action={
            <button
              type="button"
              role="switch"
              aria-checked={tail}
              onClick={() => setTail((on) => !on)}
              className="group inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Follow
              <span className={cn("relative h-5 w-9 rounded-full transition-colors", tail ? "bg-brand" : "bg-input")}>
                <span
                  className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow-xs transition-all", tail ? "left-4.5" : "left-0.5")}
                />
              </span>
            </button>
          }
        >
          <div
            ref={logBoxRef}
            className="scrollbar-on-dark max-h-112 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-200"
          >
            {logs.length === 0 && <span className="text-slate-500">Waiting for output…</span>}
            {logs.map((l) => (
              <motion.div
                key={l.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                className={cn("flex gap-3", l.stream === "stderr" ? "text-red-400" : l.stream === "system" ? "text-sky-400" : "")}
              >
                <span className="shrink-0 text-slate-600 tnum">{new Date(l.ts).toLocaleTimeString()}</span>
                <span className="break-all">{l.message}</span>
              </motion.div>
            ))}
          </div>
        </Panel>
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
  harness_content: Library,
  harness_org_secrets: KeyRound,
  harness_repos: Github,
};

type Group = "workspace" | "harness" | "cloud";

const CLOUD_GROUPS: { id: string; name: string; kinds: string[]; accent: string }[] = [
  { id: "gcp", name: "Google Cloud", kinds: ["gcp_project", "gke_cluster"], accent: "text-blue-600 dark:text-blue-400" },
  { id: "azure", name: "Azure", kinds: ["azure_resource_group", "aks_cluster"], accent: "text-sky-600 dark:text-sky-400" },
  { id: "aws", name: "AWS", kinds: ["aws_account", "eks_cluster"], accent: "text-amber-600 dark:text-amber-400" },
];

function groupOf(kind: string): Group {
  if (kind === "org_unit" || kind === "accounts") return "workspace";
  if (kind.startsWith("harness_")) return "harness";
  return "cloud";
}

const GROUP_STYLE: Record<Group, { name: string; icon: LucideIcon; badge: string; tile: string; bar: string }> = {
  workspace: {
    name: "Google Workspace",
    icon: Building2,
    badge: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    tile: "border-blue-500/25 bg-blue-500/5",
    bar: "bg-blue-500",
  },
  harness: {
    name: "Harness",
    icon: Layers,
    badge: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
    tile: "border-cyan-500/25 bg-cyan-500/5",
    bar: "bg-cyan-500",
  },
  cloud: {
    name: "Cloud resources",
    icon: Cloud,
    badge: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    tile: "border-violet-500/25 bg-violet-500/5",
    bar: "bg-violet-500",
  },
};

function BuiltPanel({ run, resources }: { run: WorkshopRun; resources: RunResource[] }) {
  const building = ACTIVE.has(run.status) && run.status !== "destroying";
  const teardownGaveUp = run.status === "destroy_failed";
  const tearingDown = !teardownGaveUp && (run.status === "destroying" || run.deleteRequested);

  const workspace = resources.filter((r) => groupOf(r.kind) === "workspace");
  const harness = resources.filter((r) => groupOf(r.kind) === "harness");
  const cloud = resources.filter((r) => groupOf(r.kind) === "cloud");
  const cloudCards = CLOUD_GROUPS.map((g) => ({ ...g, items: cloud.filter((r) => g.kinds.includes(r.kind)) })).filter(
    (g) => g.items.length > 0,
  );
  const knownCloud = new Set(CLOUD_GROUPS.flatMap((g) => g.kinds));
  const otherCloud = cloud.filter((r) => !knownCloud.has(r.kind));
  if (otherCloud.length > 0) cloudCards.push({ id: "other", name: "Other", kinds: [], accent: "text-violet-600", items: otherCloud });

  // The arrows move while the build runs and sit still once it is done.
  const flowing = building;

  return (
    <Panel
      title={building ? "Building" : "Environment"}
      description={
        teardownGaveUp
          ? "Teardown stopped early, so anything listed here may still exist."
          : tearingDown
            ? "Being torn down — these disappear as they are removed."
            : building
              ? "Each item appears here as soon as it exists."
              : `Everything this ${run.mode} created.`
      }
    >
      {resources.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing built yet — the first items appear within a minute.</p>
      ) : (
        <div className="grid min-w-0 gap-3">
          <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-0">
            {workspace.length > 0 ? <ToolCard group="workspace" items={workspace} /> : <div className="hidden lg:block" />}
            {workspace.length > 0 && harness.length > 0 ? (
              <Connector label="Accounts added" active={flowing} direction="right" />
            ) : (
              <div className="hidden lg:block" />
            )}
            {harness.length > 0 ? <ToolCard group="harness" items={harness} /> : <div className="hidden lg:block" />}
          </div>

          {cloudCards.length > 0 && (
            <>
              {workspace.length > 0 && (
                <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                  <Connector label="Cloud access granted" active={flowing} direction="down" />
                </div>
              )}
              <section className={cn("rounded-xl border p-3", GROUP_STYLE.cloud.tile)}>
                <ToolHeader group="cloud" />
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <AnimatePresence initial={false}>
                    {cloudCards.map((g) => (
                      <motion.div
                        key={g.id}
                        layout
                        initial={{ opacity: 0, scale: 0.97 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                        className="rounded-lg border bg-card p-2.5"
                      >
                        <div className={cn("mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider", g.accent)}>
                          <Cloud className="size-3.5" />
                          {g.name}
                        </div>
                        <ul className="grid gap-2">
                          {g.items.map((r) => (
                            <ResourceTile key={r.id} resource={r} group="cloud" />
                          ))}
                        </ul>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}

function ToolHeader({ group, count }: { group: Group; count?: number }) {
  const style = GROUP_STYLE[group];
  const Icon = style.icon;
  return (
    <div className="flex items-center gap-2.5">
      <span className={cn("flex size-8 items-center justify-center rounded-lg", style.badge)}>
        <Icon className="size-4.5" />
      </span>
      <h3 className="text-sm font-semibold tracking-tight">{style.name}</h3>
      {count !== undefined && (
        <span className="ml-auto rounded-full bg-background/70 px-2 py-0.5 text-xs text-muted-foreground tnum">{count}</span>
      )}
    </div>
  );
}

/** Kinds shown up front under Harness; everything created after the projects sits in the accordion. */
const HARNESS_TOP = new Set(["harness_org", "harness_projects"]);

function ToolCard({ group, items }: { group: Group; items: RunResource[] }) {
  const [open, setOpen] = useState(false);
  const top = group === "harness" ? items.filter((r) => HARNESS_TOP.has(r.kind)) : items;
  const components = group === "harness" ? items.filter((r) => !HARNESS_TOP.has(r.kind)) : [];
  const pending = components.filter((r) => r.done !== null && r.total !== null && r.done < r.total).length;
  return (
    <section className={cn("min-w-0 rounded-xl border p-3", GROUP_STYLE[group].tile)}>
      <ToolHeader group={group} count={items.length} />
      <ul className="mt-3 grid gap-2">
        <AnimatePresence initial={false}>
          {top.map((r) => (
            <ResourceTile key={r.id} resource={r} group={group} />
          ))}
        </AnimatePresence>
      </ul>
      {components.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex w-full items-center gap-2 rounded-lg border bg-card px-3 py-2.5 text-left text-sm font-medium shadow-xs"
          >
            <Boxes className="size-4 text-muted-foreground" />
            Harness components
            {pending > 0 && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
            <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground tnum">{components.length}</span>
            <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
          </button>
          {open && (
            <ul className="mt-2 grid gap-2">
              <AnimatePresence initial={false}>
                {components.map((r) => (
                  <ResourceTile key={r.id} resource={r} group={group} />
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** An arrow between two tool cards; a dot travels along it while the build runs. */
function Connector({ label, active, direction }: { label: string; active: boolean; direction: "right" | "down" }) {
  const dot = (axis: "x" | "y") => (
    <motion.span
      aria-hidden
      className="absolute size-1.5 rounded-full bg-brand"
      style={axis === "x" ? { top: -2, left: 0 } : { left: -2, top: 0 }}
      animate={axis === "x" ? { x: [0, 56], opacity: [0, 1, 0] } : { y: [0, 32], opacity: [0, 1, 0] }}
      transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
    />
  );
  const label_ = (
    <span className="rounded-full border bg-card px-2 py-0.5 text-[11px] whitespace-nowrap text-muted-foreground">{label}</span>
  );
  const horizontal = (
    <div className="hidden flex-col items-center justify-center gap-1.5 px-3 lg:flex">
      {label_}
      <div className="relative flex w-16 items-center">
        <span className="h-px flex-1 border-t-2 border-dashed border-muted-foreground/50" />
        <ArrowRight className="-ml-1 size-4 text-muted-foreground" />
        {active && dot("x")}
      </div>
    </div>
  );
  const vertical = (
    <div className={cn("flex flex-col items-center gap-1.5", direction === "right" ? "lg:hidden" : "")}>
      <div className="relative flex h-9 flex-col items-center">
        <span className="w-px flex-1 border-l-2 border-dashed border-muted-foreground/50" />
        <ArrowDown className="-mt-1 size-4 text-muted-foreground" />
        {active && dot("y")}
      </div>
      {label_}
    </div>
  );
  return direction === "right" ? (
    <>
      {horizontal}
      {vertical}
    </>
  ) : (
    <div className="flex justify-center lg:justify-self-center">{vertical}</div>
  );
}

function ResourceTile({ resource, group }: { resource: RunResource; group: Group }) {
  const Icon = RESOURCE_ICONS[resource.kind] ?? Boxes;
  const { done, total } = resource;
  const counted = done !== null && total !== null;
  const pending = counted && done < total;
  const pct = counted && total > 0 ? Math.round((done / total) * 100) : 100;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="min-w-0 rounded-lg border bg-card px-3 py-2.5 shadow-xs"
    >
      <div className="flex items-center gap-3">
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", GROUP_STYLE[group].badge)}>
          <Icon className="size-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{resource.label}</div>
          {resource.detail && <div className="truncate font-mono text-xs text-muted-foreground">{resource.detail}</div>}
        </div>

        {counted && (
          <span className={cn("shrink-0 text-sm tnum", pending ? "text-muted-foreground" : "text-foreground")}>
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
      </div>
      {counted && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
          <motion.div
            className={cn("h-full rounded-full", pending ? GROUP_STYLE[group].bar : "bg-emerald-500")}
            initial={false}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
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
    <Panel title="Attendee page">
      <div>
        <p className="text-sm text-muted-foreground">Share this link with the room to let attendees claim an account.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">{path}</code>
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
        <p className="mt-3 text-xs text-muted-foreground">This link is available to anyone and will be removed when the {mode} ends.</p>
      </div>
    </Panel>
  );
}

/** One row of the run's card: a heading, an optional control beside it, then its body. */
function Panel({
  title,
  description,
  action,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <motion.section variants={riseChild} className="space-y-4 px-5 py-4">
      <div className={cn("flex justify-between gap-4", description ? "items-start" : "items-center")}>
        <div className="grid gap-1.5">
          <h2 className="font-medium leading-none tracking-tight">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </motion.section>
  );
}

function MetaChip({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">{children}</span>;
}
