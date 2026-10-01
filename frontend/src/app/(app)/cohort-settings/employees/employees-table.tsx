"use client";

/** One page of the employees the last HiBob sync stored, sorted and searched by the database. */

import Link from "next/link";
import { motion } from "framer-motion";
import { HEADER_ROW, Pager, SortHeader, TableSearch } from "@/components/data-table";
import type { EmployeeListing } from "@/lib/evals/roster";
import type { EmployeeSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { formatDate, formatWhen } from "../format";

const COLUMNS: { column: EmployeeSort; label: string }[] = [
  { column: "fullName", label: "Name" },
  { column: "email", label: "Email" },
  { column: "title", label: "Title" },
  { column: "department", label: "Department" },
  { column: "site", label: "Site" },
  { column: "reportsToName", label: "Manager" },
  { column: "startDate", label: "Started" },
  { column: "activeEffectiveDate", label: "In role since" },
];

export function EmployeesTable({
  query,
  page,
  count,
  syncedAt,
}: {
  query: ListQuery<EmployeeSort>;
  page: Page<EmployeeListing>;
  count: number;
  syncedAt: string | null;
}) {
  const shown = page.rows;

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-4">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">Employees</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {syncedAt ? (
            <>
              <span className="font-medium text-foreground">{count.toLocaleString()} active employees</span>,
              as of the HiBob sync on {formatWhen(syncedAt)}.
            </>
          ) : (
            <>
              No employees yet — run a sync from the{" "}
              <Link href="/cohort-settings/hibob" className="underline underline-offset-4">
                HiBob
              </Link>{" "}
              tab.
            </>
          )}
        </p>
      </motion.div>

      <motion.div variants={riseChild}>
        <TableSearch
          value={query.q}
          placeholder="Search by name, email, title, department or manager"
          label="Search employees"
        />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-240 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                {COLUMNS.map(({ column, label }) => (
                  <SortHeader key={column} column={column} sort={query.sort} dir={query.dir}>
                    {label}
                  </SortHeader>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className="border-b transition-colors last:border-b-0 hover:bg-muted/30">
                  <td className="px-5 py-2.5 font-medium">{p.fullName}</td>
                  <td className="px-5 py-2.5 text-muted-foreground">{p.email}</td>
                  <td className="px-5 py-2.5">{p.title || "—"}</td>
                  <td className="px-5 py-2.5 text-muted-foreground">{p.department || "—"}</td>
                  <td className="px-5 py-2.5 text-muted-foreground">{p.site || "—"}</td>
                  <td className="px-5 py-2.5 text-muted-foreground">{p.reportsToName || p.reportsToEmail || "—"}</td>
                  <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-muted-foreground">
                    {formatDate(p.startDate)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-muted-foreground">
                    {formatDate(p.activeEffectiveDate)}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "No one matches." : page.page > 1 ? "No one on this page." : "No employees."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="employees" />
        </div>
      </motion.div>
    </motion.div>
  );
}
