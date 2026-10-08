"use client";

/**
 * Attendees' dietary needs from the intake form: how many are at each level
 * of criticality, then everyone with a need, the most critical first. A 5 is
 * an allergy or a religious restriction, so it is marked wherever it shows.
 */

import { motion } from "framer-motion";
import { TriangleAlert } from "lucide-react";
import { HEADER_ROW, Pager, PlainHeader, SortHeader, TableSearch } from "@/components/data-table";
import type { DietarySort } from "@/lib/list-specs";
import { DIETARY_LEVELS } from "@/lib/logistics/intake-values";
import type { DietaryCounts, DietaryRow } from "@/lib/logistics/responses";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { cn } from "@/lib/utils";

const COLUMNS: { column: DietarySort; label: string; className?: string }[] = [
  { column: "critical", label: "Critical", className: "w-28" },
  { column: "name", label: "Name" },
  { column: "email", label: "Email" },
];

/** What a 5 means; the other levels are only their number. */
const TOP_LABEL = "Allergy or religious";

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function DietaryView({
  query,
  page,
  counts,
}: {
  query: ListQuery<DietarySort>;
  page: Page<DietaryRow>;
  counts: DietaryCounts;
}) {
  const bars = [
    ...DIETARY_LEVELS.map((level) => ({ key: String(level), level, n: counts.byLevel[level] })),
    { key: "unrated", level: null, n: counts.unrated },
  ];
  const most = Math.max(1, ...bars.map((b) => b.n));

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="max-w-4xl space-y-6">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">Dietary needs</h2>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{plural(counts.withNeeds, "attendee", "attendees")}</span> of{" "}
          {counts.responded.toLocaleString()} who sent the intake form, of whom{" "}
          <span className="font-medium text-foreground">{counts.byLevel[5].toLocaleString()}</span> rated their needs 5
        </p>
      </motion.div>

      <motion.figure variants={riseChild} className="space-y-3 rounded-2xl border bg-card px-5 py-4 shadow-sm">
        <figcaption className="text-sm font-medium">Attendees by how critical their needs are</figcaption>
        <ul className="space-y-1.5">
          {bars.map(({ key, level, n }) => {
            const label = level === null ? "No level given" : level === 5 ? `5 · ${TOP_LABEL}` : String(level);
            const top = level === 5;
            return (
              <li
                key={key}
                title={`${plural(n, "attendee", "attendees")}: ${label}`}
                className="grid grid-cols-[11rem_1fr_2.5rem] items-center gap-3 rounded-md px-1 py-0.5 text-sm hover:bg-muted/40"
              >
                <span className={cn("flex items-center gap-1.5 truncate", top ? "font-medium" : "text-muted-foreground")}>
                  {top && <TriangleAlert className="size-3.5 shrink-0 text-destructive" aria-hidden />}
                  {label}
                </span>
                <span className="h-3 overflow-hidden rounded-r bg-muted/40">
                  <span
                    className={cn("block h-full rounded-r", top ? "bg-destructive" : level === null ? "bg-muted-foreground/40" : "bg-brand")}
                    style={{ width: n ? `max(4px, ${(n / most) * 100}%)` : 0 }}
                  />
                </span>
                <span className="text-right font-medium tabular-nums">{n.toLocaleString()}</span>
              </li>
            );
          })}
        </ul>
      </motion.figure>

      <motion.div variants={riseChild}>
        <TableSearch
          value={query.q}
          placeholder="Search by name, email or need"
          label="Search dietary needs"
        />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                {COLUMNS.map(({ column, label, className }) => (
                  <SortHeader key={column} column={column} sort={query.sort} dir={query.dir} className={className}>
                    {label}
                  </SortHeader>
                ))}
                <PlainHeader>Dietary needs</PlainHeader>
              </tr>
            </thead>
            <tbody>
              {page.rows.map((r) => (
                <tr key={r.email} className={cn("border-b last:border-b-0", r.critical === 5 && "bg-destructive/5")}>
                  <td className="px-5 py-3">
                    <Level level={r.critical} />
                  </td>
                  <td className="px-5 py-3 font-medium">{r.name || "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground">{r.email}</td>
                  <td className="px-5 py-3 whitespace-pre-line">{r.needs || <span className="text-muted-foreground">Not described</span>}</td>
                </tr>
              ))}
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "No one with dietary needs matches that search." : "No one has said they have dietary needs yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager page={page} noun="attendees" />
      </motion.div>
    </motion.div>
  );
}

/** A level 1 to 5, with a 5 marked as critical; a dash where none was given. */
function Level({ level }: { level: number | null }) {
  if (level === null) return <span className="text-muted-foreground">—</span>;
  if (level === 5) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
        <TriangleAlert className="size-3" aria-hidden />5 Critical
      </span>
    );
  }
  return <span className="tabular-nums">{level}</span>;
}
