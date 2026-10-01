"use client";

/** One page of the audit trail, searched and sorted by the database. */

import { Fragment, useState } from "react";
import { motion } from "framer-motion";
import { Ban, CheckCircle2, ChevronRight, XCircle } from "lucide-react";
import { HEADER_ROW, Pager, PlainHeader, SortHeader, TableSearch } from "@/components/data-table";
import type { AuditListing } from "@/lib/audit";
import type { AuditSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { cn } from "@/lib/utils";

const WHEN = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

const VIA_LABELS: Record<AuditListing["via"], string> = {
  session: "Browser",
  token: "API token",
  system: "Automatic",
  anonymous: "Not signed in",
};

const COLUMN_COUNT = 6;

function Outcome({ row }: { row: AuditListing }) {
  const Icon = row.outcome === "succeeded" ? CheckCircle2 : row.outcome === "denied" ? Ban : XCircle;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-xs",
        row.outcome === "succeeded" ? "text-brand" : "text-destructive",
      )}
    >
      <Icon className="size-3.5" />
      {row.outcome}
      {row.status !== null && <span className="tabular-nums text-muted-foreground">{row.status}</span>}
    </span>
  );
}

function Detail({ row }: { row: AuditListing }) {
  const facts: [string, string | null][] = [
    ["Action", row.action],
    ["Path", row.path],
    ["Target id", row.target],
    ["Account id", row.actorId],
    ["Address", row.ip],
  ];
  return (
    <div className="space-y-3 px-5 pb-4 pt-1 text-xs">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <Fragment key={k}>
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-all font-mono">{v}</dd>
            </Fragment>
          ))}
      </dl>
      {row.detail && (
        <pre className="max-h-80 overflow-auto rounded-lg border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed">
          {JSON.stringify(row.detail, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function AuditTable({ query, page }: { query: ListQuery<AuditSort>; page: Page<AuditListing> }) {
  const [open, setOpen] = useState<string | null>(null);
  const sortProps = { sort: query.sort, dir: query.dir };

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-4">
      <motion.div variants={riseChild}>
        <h1 className="text-2xl font-medium tracking-tight">Audit Trail</h1>
      </motion.div>

      <motion.div variants={riseChild}>
        <TableSearch
          value={query.q}
          placeholder="Search by who, action, target, outcome or detail"
          label="Search the audit trail"
        />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-240 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                <PlainHeader className="w-8 px-0 pl-3" />
                <SortHeader column="at" {...sortProps}>
                  When
                </SortHeader>
                <SortHeader column="actor" {...sortProps}>
                  Who
                </SortHeader>
                <SortHeader column="action" {...sortProps}>
                  Action
                </SortHeader>
                <SortHeader column="target" {...sortProps}>
                  Target
                </SortHeader>
                <SortHeader column="outcome" {...sortProps}>
                  Outcome
                </SortHeader>
              </tr>
            </thead>
            <tbody>
              {page.rows.map((row) => {
                const expanded = open === row.id;
                return (
                  <Fragment key={row.id}>
                    <tr
                      onClick={() => setOpen(expanded ? null : row.id)}
                      className={cn(
                        "cursor-pointer border-b align-top transition-colors hover:bg-muted/30",
                        expanded && "border-b-0 bg-muted/20",
                      )}
                    >
                      <td className="py-2.5 pl-3">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={expanded ? "Hide detail" : "Show detail"}
                          className="text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
                        >
                          <ChevronRight className={cn("size-4 transition-transform", expanded && "rotate-90")} />
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-muted-foreground">
                        {WHEN.format(new Date(row.at))}
                      </td>
                      <td className="px-5 py-2.5">
                        <div className="font-medium">{row.actorName || row.actorEmail || "—"}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.actorName && row.actorEmail ? `${row.actorEmail} · ` : ""}
                          {VIA_LABELS[row.via]}
                        </div>
                      </td>
                      <td className="px-5 py-2.5">
                        <div>{row.summary}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{row.action}</div>
                      </td>
                      <td className="max-w-64 px-5 py-2.5">
                        <div className="truncate">{row.targetLabel || row.target || "—"}</div>
                      </td>
                      <td className="px-5 py-2.5">
                        <Outcome row={row} />
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b bg-muted/20">
                        <td colSpan={COLUMN_COUNT}>
                          <Detail row={row} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMN_COUNT} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "Nothing matches." : "Nothing has been recorded yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="entries" />
        </div>
      </motion.div>
    </motion.div>
  );
}
