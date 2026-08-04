"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  ExternalLink,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
// Type-only: erased at compile time, so the `server-only` module behind it is
// never pulled into the client bundle.
import type {
  AuditUnavailable,
  AuditedProject,
  ProjectAudit,
  ProjectClassification,
} from "@/lib/projects-audit";

const ERROR_MESSAGE: Record<AuditUnavailable, string> = {
  not_configured:
    "No billing account is configured for this deployment (GCP_BILLING_ACCOUNT_ID is unset).",
  permission_denied:
    "The app service account can't read the billing account yet. Grant it roles/billing.viewer — the binding is in infra/admin/iam.tf; apply it with `make infra`.",
  unavailable:
    "Couldn't reach the Cloud Billing API just now. Try refreshing in a moment.",
};

const consoleUrl = (projectId: string) =>
  `https://console.cloud.google.com/home/dashboard?project=${encodeURIComponent(projectId)}`;

/** Which subset of the projects the table is showing. */
type Filter = "all" | ProjectClassification;
/** Which column the table is sorted by, and in which direction. */
type SortColumn = "project" | "name";
type Sort = { column: SortColumn; dir: "asc" | "desc" } | null;

export function CloudStatus({
  initial,
  error,
}: {
  initial: ProjectAudit | null;
  error: AuditUnavailable | null;
}) {
  const [audit, setAudit] = useState<ProjectAudit | null>(initial);
  const [message, setMessage] = useState<string | null>(
    error ? ERROR_MESSAGE[error] : null,
  );
  const [pending, setPending] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>(null);

  const refresh = useCallback(async () => {
    setPending(true);
    try {
      const res = await fetch("/api/cloud-status", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const key = body?.error as AuditUnavailable | undefined;
        throw new Error(
          (key && ERROR_MESSAGE[key]) ?? `Couldn't load projects (${res.status})`,
        );
      }
      setAudit(body.audit);
      setMessage(null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Couldn't load projects");
    } finally {
      setPending(false);
    }
  }, []);

  /** Click a column header: sort asc → desc → back to the default order. */
  const toggleSort = useCallback((column: SortColumn) => {
    setSort((prev) => {
      if (!prev || prev.column !== column) return { column, dir: "asc" };
      if (prev.dir === "asc") return { column, dir: "desc" };
      return null;
    });
  }, []);

  // Filter, then sort. With no sort the server order (untracked-first) stands.
  const rows = useMemo(() => {
    if (!audit) return [];
    const filtered =
      filter === "all"
        ? audit.projects
        : audit.projects.filter((p) => p.classification === filter);
    if (!sort) return filtered;
    const key = (p: AuditedProject) =>
      sort.column === "project" ? p.projectId : (p.name ?? "").toLowerCase();
    return [...filtered].sort((a, b) => {
      const c = key(a).localeCompare(key(b));
      return sort.dir === "asc" ? c : -c;
    });
  }, [audit, filter, sort]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium tracking-tight">Cloud Status</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every Google Cloud project billed to
            {audit ? (
              <span className="font-mono"> {audit.billingAccountId}</span>
            ) : (
              " the workshop billing account"
            )}
            , matched against the runs database. Projects with no matching run —
            and that aren&rsquo;t the control plane or sandbox — are flagged.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {pending ? "Checking…" : "Refresh"}
        </Button>
      </div>

      {message && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-start gap-2.5 py-4 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span>{message}</span>
          </CardContent>
        </Card>
      )}

      {audit && (
        <>
          {/* Counts double as filters — click one to narrow the table. */}
          <div className="flex flex-wrap gap-3">
            <FilterButton
              label="Billed projects"
              value={audit.counts.total}
              active={filter === "all"}
              onClick={() => setFilter("all")}
            />
            <FilterButton
              label="Untracked"
              value={audit.counts.untracked}
              tone={audit.counts.untracked > 0 ? "alert" : "ok"}
              active={filter === "untracked"}
              onClick={() => setFilter("untracked")}
            />
            <FilterButton
              label="Tracked"
              value={audit.counts.tracked}
              active={filter === "tracked"}
              onClick={() => setFilter("tracked")}
            />
            <FilterButton
              label="Infra"
              value={audit.counts.infra}
              active={filter === "infra"}
              onClick={() => setFilter("infra")}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Google Cloud</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <SortableHeader
                        label="Project"
                        column="project"
                        sort={sort}
                        onSort={toggleSort}
                      />
                      <SortableHeader
                        label="Project Name"
                        column="name"
                        sort={sort}
                        onSort={toggleSort}
                      />
                      <th className="px-6 pb-2 font-medium">Billing</th>
                      <th className="px-6 pb-2 font-medium">Association</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <ProjectRow key={p.projectId} project={p} />
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-6 py-6 text-center text-muted-foreground"
                        >
                          No projects in this view.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {audit.missingFromBilling.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Referenced by a run, not billed ({audit.missingFromBilling.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <p className="text-muted-foreground">
                  A run still records these project ids, but the billing account
                  doesn&rsquo;t list them — usually a project already deleted.
                </p>
                {audit.missingFromBilling.map((m) => (
                  <div key={m.projectId} className="flex flex-wrap gap-3">
                    <span className="font-mono break-all">{m.projectId}</span>
                    <span className="text-muted-foreground">
                      {m.name} · {m.status}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function SortableHeader({
  label,
  column,
  sort,
  onSort,
}: {
  label: string;
  column: SortColumn;
  sort: Sort;
  onSort: (column: SortColumn) => void;
}) {
  const active = sort?.column === column;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className="px-6 pb-2 font-medium">
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "inline-flex cursor-pointer items-center gap-1 uppercase tracking-wider outline-none hover:text-foreground focus-visible:text-foreground",
          active && "text-foreground",
        )}
      >
        {label}
        <Icon className={cn("size-3", !active && "opacity-40")} />
      </button>
    </th>
  );
}

function ProjectRow({ project }: { project: AuditedProject }) {
  const flagged = project.classification === "untracked";
  return (
    <tr
      className={cn(
        "border-t transition-colors",
        flagged ? "bg-destructive/5 hover:bg-destructive/10" : "hover:bg-muted/40",
      )}
    >
      <td className="px-6 py-3">
        <a
          href={consoleUrl(project.projectId)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 font-mono break-all hover:underline"
        >
          {project.projectId}
          <ExternalLink className="size-3 shrink-0 opacity-60" />
        </a>
      </td>
      <td className="px-6 py-3">
        {project.name ?? <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-6 py-3">
        <span
          className={cn(
            "text-xs",
            project.billingEnabled
              ? "text-muted-foreground"
              : "text-amber-600 dark:text-amber-500",
          )}
        >
          {project.billingEnabled ? "enabled" : "disabled"}
        </span>
      </td>
      <td className="px-6 py-3">
        {project.classification === "untracked" ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-destructive">
            <TriangleAlert className="size-3.5 shrink-0" />
            No run — investigate
          </span>
        ) : project.classification === "infra" ? (
          <span className="text-muted-foreground">Control plane / sandbox</span>
        ) : (
          <span>
            {project.owner?.name}
            <span className="text-muted-foreground">
              {" · "}
              {project.owner?.mode}
              {" · "}
              {project.owner?.status}
              {project.owner?.attendee ? ` · ${project.owner.attendee}` : ""}
            </span>
          </span>
        )}
      </td>
    </tr>
  );
}

function FilterButton({
  label,
  value,
  active,
  tone = "neutral",
  onClick,
}: {
  label: string;
  value: number;
  active: boolean;
  tone?: "neutral" | "ok" | "alert";
  onClick: () => void;
}) {
  const alert = tone === "alert";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "cursor-pointer rounded-lg border px-4 py-3 text-left outline-none transition-colors",
        "hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50",
        active && "border-foreground/30 bg-muted",
        alert && "border-destructive/40 bg-destructive/5 hover:bg-destructive/10",
        alert && active && "border-destructive/60 bg-destructive/10",
      )}
    >
      <div
        className={cn(
          "text-2xl font-medium tabular-nums",
          alert && "text-destructive",
        )}
      >
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </button>
  );
}
