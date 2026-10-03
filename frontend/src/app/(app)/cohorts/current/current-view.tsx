"use client";

/** How many are on each track, then one page of everyone on the Sales or Engineer track. */

import { motion } from "framer-motion";
import { Briefcase, Wrench, type LucideIcon } from "lucide-react";
import { HEADER_ROW, Pager, SortHeader, TableSearch } from "@/components/data-table";
import type { CurrentCohortMember, CurrentTrack } from "@/lib/evals/current-cohort";
import type { CurrentCohortSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { formatWhen } from "../../cohort-settings/format";

const CARDS: { track: CurrentTrack; label: string; Icon: LucideIcon }[] = [
  { track: "sales", label: "Total sales", Icon: Briefcase },
  { track: "engineer", label: "Total engineer", Icon: Wrench },
];

const COLUMNS: { column: CurrentCohortSort; label: string }[] = [
  { column: "fullName", label: "Name" },
  { column: "email", label: "Email" },
  { column: "title", label: "Title" },
  { column: "department", label: "Department" },
  { column: "reportsToName", label: "Manager" },
  { column: "track", label: "Track" },
];

export function CurrentCohortView({
  query,
  page,
  counts,
  syncedAt,
}: {
  query: ListQuery<CurrentCohortSort>;
  page: Page<CurrentCohortMember>;
  /** Everyone on each track, whatever the search. */
  counts: Record<CurrentTrack, number>;
  syncedAt: string | null;
}) {
  const shown = page.rows;
  const total = counts.sales + counts.engineer;

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-4">
      <motion.div variants={riseChild} className="grid gap-4 sm:grid-cols-2 lg:max-w-2xl">
        {CARDS.map(({ track, label, Icon }) => (
          <div key={track} className="flex items-center gap-4 rounded-2xl border bg-card px-5 py-4 shadow-sm">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
              <Icon className="size-5 text-muted-foreground" />
            </span>
            <div>
              <div className="text-3xl font-medium tabular-nums">{counts[track].toLocaleString()}</div>
              <div className="text-sm text-muted-foreground">{label}</div>
            </div>
          </div>
        ))}
      </motion.div>

      <motion.div variants={riseChild} className="space-y-1.5 pt-4">
        <h2 className="text-xl font-medium tracking-tight">Current</h2>
        {syncedAt && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">{total.toLocaleString()} people</span> on the sales or
            engineer track, as of the HiBob sync on {formatWhen(syncedAt)}.
          </p>
        )}
      </motion.div>

      <motion.div variants={riseChild}>
        <TableSearch
          value={query.q}
          placeholder="Search by name, email, title, manager or track"
          label="Search the current cohort"
        />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-200 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                {COLUMNS.map((c) => (
                  <SortHeader key={c.column} column={c.column} sort={query.sort} dir={query.dir}>
                    {c.label}
                  </SortHeader>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.email} className="border-b transition-colors last:border-b-0 hover:bg-muted/30">
                  <td className="px-5 py-2.5 font-medium">{m.fullName}</td>
                  <td className="px-5 py-2.5 text-muted-foreground">{m.email}</td>
                  <td className="px-5 py-2.5">{m.title || "—"}</td>
                  <td className="px-5 py-2.5 text-muted-foreground">{m.department || "—"}</td>
                  <td className="px-5 py-2.5 text-muted-foreground">{m.reportsToName || m.reportsToEmail || "—"}</td>
                  <td className="px-5 py-2.5">{m.track}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-5 py-8 text-center text-muted-foreground">
                    {total ? "No one matches." : "No one is on the sales or engineer track yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="people" />
        </div>
      </motion.div>
    </motion.div>
  );
}
