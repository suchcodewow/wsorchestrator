"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  CircleSlash,
  ExternalLink,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CLOUDS, type Cloud } from "@/db/schema";
import { cn } from "@/lib/utils";
// Type-only: erased at compile time, so the `server-only` modules behind these
// are never pulled into the client bundle.
import type {
  AuditUnavailable,
  AuditedResource,
  Classification,
  CloudAudit,
  CloudStatusReport,
} from "@/lib/cloud-audit/types";

/**
 * All the per-cloud wording in one place. The audits themselves carry only the
 * column and scope labels they can't be written without; everything explanatory
 * lives here, next to what renders it.
 */
const COPY: Record<
  Cloud,
  {
    /** Tab label — short, because three of them share a row. */
    tab: string;
    /** What the table is a list of, in the header sentence and the total tile. */
    plural: string;
    /** One line under the title explaining what "untracked" means for this cloud. */
    blurb: string;
    /** What `infra` means here. */
    infra: string;
    /** What `unmanaged` means here. Null when the cloud can't produce any. */
    unmanaged: string | null;
    missing: { title: string; note: string };
    errors: Record<AuditUnavailable, string>;
  }
> = {
  gcp: {
    tab: "Google Cloud",
    plural: "projects",
    blurb:
      "Every project billed to the workshop account, matched against the runs database. A project with no matching run — and that isn’t the control plane or sandbox — is flagged.",
    infra: "Control plane / sandbox",
    unmanaged: null,
    missing: {
      title: "Referenced by a run, not billed",
      note: "A run still records these project ids, but the billing account doesn’t list them — usually a project already deleted.",
    },
    errors: {
      not_configured:
        "No billing account is configured for this deployment (GCP_BILLING_ACCOUNT_ID is unset).",
      permission_denied:
        "The app service account can’t read the billing account yet. Grant it roles/billing.viewer — the binding is in infra/admin/iam.tf; apply it with `make infra`.",
      unavailable:
        "Couldn’t reach the Cloud Billing API just now. Try refreshing in a moment.",
    },
  },
  aws: {
    tab: "AWS",
    plural: "accounts",
    blurb:
      "Every account in the workshop organization, matched against the runs database. Member accounts bill to the management account, so an account with no matching run is a cost nobody has claimed.",
    infra: "Management / permanent",
    unmanaged: null,
    missing: {
      title: "Referenced by a run, not in the organization",
      note: "A run still records these account ids, but the organization doesn’t list them — an account closed long enough ago that AWS has dropped it.",
    },
    errors: {
      not_configured:
        "AWS isn’t configured for this deployment (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are unset).",
      permission_denied:
        "The credentials were refused by AWS Organizations. They must belong to the organization’s management account and allow organizations:ListAccounts and organizations:DescribeOrganization.",
      unavailable:
        "Couldn’t reach AWS Organizations just now. Try refreshing in a moment.",
    },
  },
  azure: {
    tab: "Azure",
    plural: "resource groups",
    blurb:
      "Every resource group in the workshop subscription. The subscription is shared, so only groups this orchestrator tagged can be orphans; anything else is listed as unmanaged.",
    infra: "Permanent (configured)",
    unmanaged: "Not created here",
    missing: {
      title: "Referenced by a run, not in the subscription",
      note: "A run still records these resource groups, but the subscription doesn’t list them — usually a group already deleted.",
    },
    errors: {
      not_configured:
        "Azure isn’t configured for this deployment (AZURE_SUBSCRIPTION_ID, AZURE_TENANT_ID, ARM_CLIENT_ID and ARM_CLIENT_SECRET are needed).",
      permission_denied:
        "Azure refused the service principal. It needs at least Reader on the subscription, and its client secret must not have expired.",
      unavailable:
        "Couldn’t reach Azure Resource Manager just now. Try refreshing in a moment.",
    },
  },
};

/** Which subset of one cloud's resources the table is showing. */
type Filter = "all" | Classification;
/** Which column the table is sorted by, and in which direction. */
type SortColumn = "id" | "name";
type Sort = { column: SortColumn; dir: "asc" | "desc" } | null;

export function CloudStatus({
  initial,
  opening,
}: {
  initial: CloudStatusReport;
  opening: Cloud;
}) {
  const [report, setReport] = useState(initial);
  const [cloud, setCloud] = useState<Cloud>(opening);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Per cloud, so switching tabs doesn't carry a filter that means something
  // different — "Unmanaged" exists on Azure and nowhere else.
  const [filters, setFilters] = useState<Partial<Record<Cloud, Filter>>>({});
  const [sorts, setSorts] = useState<Partial<Record<Cloud, Sort>>>({});

  const filter = filters[cloud] ?? "all";
  const sort = sorts[cloud] ?? null;
  const result = report[cloud];

  const refresh = useCallback(async () => {
    setPending(true);
    try {
      const res = await fetch("/api/cloud-status", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.report) {
        throw new Error(`Couldn’t refresh the cloud audit (${res.status})`);
      }
      setReport(body.report as CloudStatusReport);
      setMessage(null);
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : "Couldn’t refresh the cloud audit",
      );
    } finally {
      setPending(false);
    }
  }, []);

  /** Click a column header: sort asc → desc → back to the default order. */
  const toggleSort = useCallback(
    (column: SortColumn) => {
      setSorts((prev) => {
        const current = prev[cloud] ?? null;
        const next: Sort =
          !current || current.column !== column
            ? { column, dir: "asc" }
            : current.dir === "asc"
              ? { column, dir: "desc" }
              : null;
        return { ...prev, [cloud]: next };
      });
    },
    [cloud],
  );

  // Filter, then sort. With no sort the server order (untracked-first) stands.
  const rows = useMemo(() => {
    if (!result.ok) return [];
    const filtered =
      filter === "all"
        ? result.audit.resources
        : result.audit.resources.filter((r) => r.classification === filter);
    if (!sort) return filtered;
    const key = (r: AuditedResource) =>
      sort.column === "id" ? r.id.toLowerCase() : (r.name ?? "").toLowerCase();
    return [...filtered].sort((a, b) => {
      const c = key(a).localeCompare(key(b));
      return sort.dir === "asc" ? c : -c;
    });
  }, [result, filter, sort]);

  const copy = COPY[cloud];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-medium tracking-tight">Cloud Status</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What each cloud is actually carrying, matched against the runs
            database. Anything billed that no run claims is flagged here.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {pending ? "Checking…" : "Refresh"}
        </Button>
      </div>

      {message && <Problem>{message}</Problem>}

      {/* One tab per cloud, each showing its own headline so a problem in a
          cloud the admin isn't looking at is still visible from here. */}
      <div
        role="tablist"
        aria-label="Cloud"
        className="flex flex-wrap items-stretch gap-2"
      >
        {CLOUDS.map((c) => (
          <CloudTab
            key={c}
            label={COPY[c].tab}
            plural={COPY[c].plural}
            result={report[c]}
            active={c === cloud}
            onClick={() => setCloud(c)}
          />
        ))}
      </div>

      {!result.ok ? (
        <Problem>{copy.errors[result.error]}</Problem>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {copy.blurb}{" "}
            <span className="whitespace-nowrap">
              {result.audit.scope.label}:{" "}
              {result.audit.scope.url ? (
                <a
                  href={result.audit.scope.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono hover:underline"
                >
                  {result.audit.scope.name ?? result.audit.scope.value}
                </a>
              ) : (
                <span className="font-mono">
                  {result.audit.scope.name ?? result.audit.scope.value}
                </span>
              )}
            </span>
          </p>

          {/* Counts double as filters — click one to narrow the table. */}
          <Counts
            audit={result.audit}
            copy={copy}
            filter={filter}
            onFilter={(f) => setFilters((prev) => ({ ...prev, [cloud]: f }))}
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{copy.tab}</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <SortableHeader
                        label={result.audit.columns.id}
                        column="id"
                        sort={sort}
                        onSort={toggleSort}
                      />
                      <SortableHeader
                        label={result.audit.columns.name}
                        column="name"
                        sort={sort}
                        onSort={toggleSort}
                      />
                      <th className="px-6 pb-2 font-medium">
                        {result.audit.columns.state}
                      </th>
                      <th className="px-6 pb-2 font-medium">Association</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <ResourceRow key={r.id} resource={r} copy={copy} />
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-6 py-6 text-center text-muted-foreground"
                        >
                          No {copy.plural} in this view.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {result.audit.missing.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {copy.missing.title} ({result.audit.missing.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <p className="text-muted-foreground">{copy.missing.note}</p>
                {result.audit.missing.map((m) => (
                  <div key={m.id} className="flex flex-wrap gap-3">
                    <span className="font-mono wrap-break-word">{m.id}</span>
                    <span className="text-muted-foreground">
                      <RunLink runId={m.runId} name={m.name} /> · {m.status}
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

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardContent className="flex items-start gap-2.5 py-4 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
        <span>{children}</span>
      </CardContent>
    </Card>
  );
}

/**
 * A cloud's tab: its name, and the one number that matters for it. An
 * unconfigured cloud stays selectable — the panel then explains which env vars
 * are missing, which is more useful than a tab that does nothing.
 */
function CloudTab({
  label,
  plural,
  result,
  active,
  onClick,
}: {
  label: string;
  plural: string;
  result: CloudStatusReport[Cloud];
  active: boolean;
  onClick: () => void;
}) {
  const untracked = result.ok ? result.audit.counts.untracked : 0;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex cursor-pointer flex-col gap-0.5 rounded-lg border px-4 py-2.5 text-left outline-none transition-colors",
        "hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50",
        active && "border-foreground/30 bg-muted",
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        {label}
        {untracked > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive tabular-nums">
            <TriangleAlert className="size-3" />
            {untracked}
          </span>
        )}
      </span>
      <span className="text-xs text-muted-foreground">
        {result.ok ? (
          `${result.audit.counts.total} ${plural}`
        ) : result.error === "not_configured" ? (
          "Not configured"
        ) : (
          <span className="text-amber-600 dark:text-amber-500">Unavailable</span>
        )}
      </span>
    </button>
  );
}

/**
 * The count tiles. `total`, `untracked` and `tracked` are always shown — a zero
 * there is the answer, not an absence. `infra` and `unmanaged` appear only when
 * the cloud has any, so GCP and AWS never carry a permanently-empty
 * "Unmanaged 0".
 */
function Counts({
  audit,
  copy,
  filter,
  onFilter,
}: {
  audit: CloudAudit;
  copy: (typeof COPY)[Cloud];
  filter: Filter;
  onFilter: (filter: Filter) => void;
}) {
  const tiles: Array<{ key: Filter; label: string; alert?: boolean }> = [
    { key: "all", label: `Total ${copy.plural}` },
    { key: "untracked", label: "Untracked", alert: true },
    { key: "tracked", label: "Tracked" },
    ...(audit.counts.infra > 0
      ? [{ key: "infra" as Filter, label: "Infra" }]
      : []),
    ...(audit.counts.unmanaged > 0
      ? [{ key: "unmanaged" as Filter, label: copy.unmanaged ?? "Unmanaged" }]
      : []),
  ];

  return (
    <div className="flex flex-wrap gap-3">
      {tiles.map(({ key, label, alert }) => {
        const value = key === "all" ? audit.counts.total : audit.counts[key];
        return (
          <FilterButton
            key={key}
            label={label}
            value={value}
            tone={alert && value > 0 ? "alert" : "neutral"}
            active={filter === key}
            onClick={() => onFilter(key)}
          />
        );
      })}
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

/** The run a resource belongs to, linked so an orphan hunt can start from here. */
function RunLink({ runId, name }: { runId: string; name: string }) {
  return (
    <Link href={`/runs/${runId}`} className="hover:underline">
      {name}
    </Link>
  );
}

function ResourceRow({
  resource,
  copy,
}: {
  resource: AuditedResource;
  copy: (typeof COPY)[Cloud];
}) {
  const flagged = resource.classification === "untracked";
  return (
    <tr
      className={cn(
        "border-t transition-colors",
        flagged ? "bg-destructive/5 hover:bg-destructive/10" : "hover:bg-muted/40",
      )}
    >
      {/* wrap-break-word, not break-all: an AWS account number is one long run of
          digits, and break-all splits it mid-number into something unreadable.
          This only breaks an identifier that cannot fit a line of its own, which
          is what Azure's `MC_<rg>_<cluster>_<region>` node-group names need. */}
      <td className="px-6 py-3">
        {resource.url ? (
          // Deliberately not inline-flex: an id that wraps makes the flex box as
          // wide as the cell, and the icon strands itself at the far right
          // looking like a column of its own. Inline keeps it against the last
          // line of the name, wherever that ends.
          <a
            href={resource.url}
            target="_blank"
            rel="noreferrer"
            className="font-mono wrap-break-word hover:underline"
          >
            {resource.id}
            <ExternalLink className="ml-1.5 inline size-3 shrink-0 align-[-0.1em] opacity-60" />
          </a>
        ) : (
          <span className="font-mono wrap-break-word">{resource.id}</span>
        )}
      </td>
      <td className="px-6 py-3">
        {resource.name ?? <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-6 py-3">
        {resource.state && (
          <span
            className={cn(
              "text-xs",
              resource.state.ok
                ? "text-muted-foreground"
                : "text-amber-600 dark:text-amber-500",
            )}
          >
            {resource.state.label}
          </span>
        )}
      </td>
      <td className="px-6 py-3">
        {resource.classification === "untracked" ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-destructive">
            <TriangleAlert className="size-3.5 shrink-0" />
            No run — investigate
          </span>
        ) : resource.classification === "infra" ? (
          <span className="text-muted-foreground">{copy.infra}</span>
        ) : resource.classification === "unmanaged" ? (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <CircleSlash className="size-3.5 shrink-0 opacity-60" />
            {copy.unmanaged ?? "Unmanaged"}
          </span>
        ) : resource.owner ? (
          <span>
            <RunLink runId={resource.owner.runId} name={resource.owner.name} />
            <span className="text-muted-foreground">
              {" · "}
              {resource.owner.mode}
              {" · "}
              {resource.owner.status}
              {resource.owner.attendee ? ` · ${resource.owner.attendee}` : ""}
            </span>
          </span>
        ) : null}
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
  tone?: "neutral" | "alert";
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
