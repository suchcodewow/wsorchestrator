"use client";

/** One page of bootcamp history, a name and email each; a row opens that person's record. */

import Link from "next/link";
import { motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { HEADER_ROW, Pager, PlainHeader, SortHeader, TableSearch } from "@/components/data-table";
import type { HistoryListing } from "@/lib/evals/bootcamp-history";
import type { BootcampHistorySort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";

const COLUMNS: { column: BootcampHistorySort; label: string }[] = [
  { column: "fullName", label: "Name" },
  { column: "email", label: "Email" },
];

export function HistoryTable({
  query,
  page,
  count,
}: {
  query: ListQuery<BootcampHistorySort>;
  page: Page<HistoryListing>;
  count: number;
}) {
  const shown = page.rows;

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="max-w-2xl space-y-6">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h1 className="text-3xl font-medium tracking-tight">Bootcamp History</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">
            {count.toLocaleString()} {count === 1 ? "person" : "people"}
          </span>{" "}
          with a BTC or INT record.
        </p>
      </motion.div>

      <motion.div variants={riseChild}>
        <TableSearch value={query.q} placeholder="Search by name or email" label="Search bootcamp history" />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                {COLUMNS.map(({ column, label }) => (
                  <SortHeader key={column} column={column} sort={query.sort} dir={query.dir}>
                    {label}
                  </SortHeader>
                ))}
                <PlainHeader className="w-10" />
              </tr>
            </thead>
            <tbody>
              {shown.map((h) => {
                const href = `/bootcamp-history/${h.id}`;
                return (
                  <tr key={h.id} className="group border-b transition-colors last:border-b-0 hover:bg-muted/30">
                    <td className="p-0 font-medium">
                      <Link href={href} className="block px-5 py-2.5 outline-none focus-visible:bg-muted/50">
                        {h.fullName ?? <span className="font-normal text-muted-foreground">—</span>}
                      </Link>
                    </td>
                    <td className="p-0 text-muted-foreground">
                      <Link href={href} tabIndex={-1} className="block px-5 py-2.5">
                        {h.email}
                      </Link>
                    </td>
                    <td className="p-0">
                      <Link href={href} tabIndex={-1} aria-hidden className="flex justify-end px-3 py-2.5">
                        <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "No one matches." : page.page > 1 ? "No one on this page." : "No bootcamp history yet."}
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
