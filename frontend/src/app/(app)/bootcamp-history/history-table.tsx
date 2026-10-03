"use client";

/**
 * One page of bootcamp history, a name, email and bootcamp date each; a row
 * opens that person's record. The Active and Inactive counters beside the
 * search narrow the list to one or the other.
 */

import { useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronRight, UserCheck, UserX, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { HEADER_ROW, Pager, PlainHeader, SortHeader, TableSearch } from "@/components/data-table";
import { EXEMPT_DATE } from "@/db/schema";
import type { HistoryCounts, HistoryListing } from "@/lib/evals/bootcamp-history";
import type { BootcampHistorySort, HistoryStatus } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { cn } from "@/lib/utils";
import { formatDate } from "../cohort-settings/format";

const COLUMNS: { column: BootcampHistorySort; label: string; className?: string }[] = [
  { column: "fullName", label: "Name" },
  { column: "email", label: "Email" },
  { column: "btcDate", label: "Bootcamp", className: "whitespace-nowrap" },
];

const STATUSES: { status: HistoryStatus; label: string; title: string; Icon: LucideIcon }[] = [
  { status: "active", label: "Active", title: "Still in the employee list from the last HiBob sync", Icon: UserCheck },
  { status: "inactive", label: "Inactive", title: "Not in the employee list from the last HiBob sync", Icon: UserX },
];

/** Shows only `status`, or everyone again when it is the one already shown; back to page 1 either way. */
function useStatusFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function toggle(status: HistoryStatus) {
    const next = new URLSearchParams(params.toString());
    if (next.get("status") === status) next.delete("status");
    else next.set("status", status);
    next.delete("page");
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return { toggle, pending };
}

export function HistoryTable({
  query,
  status,
  page,
  counts,
}: {
  query: ListQuery<BootcampHistorySort>;
  /** The one status shown, or null for everyone. */
  status: HistoryStatus | null;
  page: Page<HistoryListing>;
  /** Everyone, and the active and inactive, whatever the search. */
  counts: HistoryCounts;
}) {
  const { toggle, pending } = useStatusFilter();
  const shown = page.rows;

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="max-w-3xl space-y-6">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h1 className="text-3xl font-medium tracking-tight">Bootcamp History</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">
            {counts.total.toLocaleString()} {counts.total === 1 ? "person" : "people"}
          </span>{" "}
          with a BTC or INT record.
        </p>
      </motion.div>

      <motion.div variants={riseChild} className="flex flex-wrap items-center gap-3">
        <TableSearch
          value={query.q}
          placeholder="Search by name or email"
          label="Search bootcamp history"
          className="min-w-56 flex-1"
        />
        <div role="group" aria-label="Show" className="flex gap-2">
          {STATUSES.map(({ status: s, label, title, Icon }) => {
            const on = status === s;
            return (
              <button
                key={s}
                type="button"
                title={title}
                aria-pressed={on}
                disabled={pending}
                onClick={() => toggle(s)}
                className={cn(
                  "inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-sm shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-wait",
                  on
                    ? "border-brand-border bg-brand-subtle text-foreground"
                    : "bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                <Icon className={cn("size-4", on && "text-brand")} />
                {label}
                <span className="font-medium tabular-nums text-foreground">{counts[s].toLocaleString()}</span>
              </button>
            );
          })}
        </div>
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
                    <td className="p-0 whitespace-nowrap tabular-nums text-muted-foreground">
                      <Link href={href} tabIndex={-1} className="block px-5 py-2.5">
                        {h.btcDate === EXEMPT_DATE ? <Badge variant="secondary">Exempt</Badge> : formatDate(h.btcDate)}
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
                    {query.q || status
                      ? "No one matches."
                      : page.page > 1
                        ? "No one on this page."
                        : "No bootcamp history yet."}
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
