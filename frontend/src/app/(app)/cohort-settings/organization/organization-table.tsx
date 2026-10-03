"use client";

/** One page of everyone under the Organization Leader, as of the last HiBob sync. */

import Link from "next/link";
import { motion } from "framer-motion";
import { TriangleAlert } from "lucide-react";
import { HEADER_ROW, Pager, SortHeader, TableSearch } from "@/components/data-table";
import type { OrganizationMember } from "@/lib/evals/roster";
import type { OrganizationSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { formatHistoryDate, formatScore } from "../format";

const COLUMNS: { column: OrganizationSort; label: string }[] = [
  { column: "fullName", label: "Name" },
  { column: "email", label: "Email" },
  { column: "title", label: "Title" },
  { column: "department", label: "Department" },
  { column: "track", label: "Track" },
  { column: "btcDate", label: "BTC date" },
  { column: "btcScore", label: "BTC score" },
  { column: "intDate", label: "INT date" },
  { column: "intScore", label: "INT score" },
];

export function OrganizationTable({
  query,
  page,
  count,
  leaderEmail,
  leaderName,
  current,
}: {
  query: ListQuery<OrganizationSort>;
  page: Page<OrganizationMember>;
  /** Everyone the sync found, whatever the search. */
  count: number;
  leaderEmail: string | null;
  leaderName: string | null;
  current: boolean;
}) {
  const shown = page.rows;

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-4">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">Organization</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {leaderEmail ? (
            <>
              <span className="font-medium text-foreground">{count.toLocaleString()} people</span> report
              up to {leaderName ?? leaderEmail}, as of the last HiBob sync.
            </>
          ) : (
            <>
              No Organization Leader has been synced yet — set one on the{" "}
              <Link href="/cohort-settings/automation" className="underline underline-offset-4">
                Automation
              </Link>{" "}
              tab, then run a sync from the{" "}
              <Link href="/cohort-settings/hibob" className="underline underline-offset-4">
                HiBob
              </Link>{" "}
              tab.
            </>
          )}
        </p>
        {leaderEmail && !current && (
          <p className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400">
            <TriangleAlert className="size-3.5" />
            The Organization Leader has changed since this sync — run a new sync to update this list.
          </p>
        )}
      </motion.div>

      <motion.div variants={riseChild}>
        <TableSearch
          value={query.q}
          placeholder="Search by name, email, title, manager or track"
          label="Search the organization"
        />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-280 text-sm">
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
                  <td className="px-5 py-2.5">{m.track ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-muted-foreground">
                    {formatHistoryDate(m.btcDate)}
                  </td>
                  <td className="px-5 py-2.5 tabular-nums">{formatScore(m.btcScore)}</td>
                  <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-muted-foreground">
                    {formatHistoryDate(m.intDate)}
                  </td>
                  <td className="px-5 py-2.5 tabular-nums">{formatScore(m.intScore)}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-5 py-8 text-center text-muted-foreground">
                    {count ? "No one matches." : "No one reports up to the leader yet."}
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
