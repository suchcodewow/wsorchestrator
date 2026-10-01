"use client";

/** Every employee the last HiBob sync stored, sortable by any column and searchable. */

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { EmployeeListing } from "@/lib/evals/roster";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { formatDate, formatWhen } from "../format";

type Column = "fullName" | "email" | "title" | "department" | "site" | "reportsToName" | "startDate" | "activeEffectiveDate";
type Sort = { column: Column; dir: "asc" | "desc" };

const COLUMNS: { column: Column; label: string }[] = [
  { column: "fullName", label: "Name" },
  { column: "email", label: "Email" },
  { column: "title", label: "Title" },
  { column: "department", label: "Department" },
  { column: "site", label: "Site" },
  { column: "reportsToName", label: "Manager" },
  { column: "startDate", label: "Started" },
  { column: "activeEffectiveDate", label: "In role since" },
];

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function valueOf(p: EmployeeListing, column: Column): string {
  if (column === "reportsToName") return p.reportsToName || p.reportsToEmail;
  return p[column] ?? "";
}

export function EmployeesTable({ people, syncedAt }: { people: EmployeeListing[]; syncedAt: string | null }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>({ column: "fullName", dir: "asc" });

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? people.filter((p) =>
          [p.fullName, p.email, p.title, p.department, p.site, p.reportsToName, p.reportsToEmail].some((v) =>
            v.toLowerCase().includes(q),
          ),
        )
      : people;
    return [...matched].sort((a, b) => {
      const x = valueOf(a, sort.column);
      const y = valueOf(b, sort.column);
      // Blanks sink to the bottom whichever way the column is sorted.
      if (!x || !y) return x ? -1 : y ? 1 : 0;
      const c = collator.compare(x, y) || collator.compare(a.fullName, b.fullName);
      return sort.dir === "asc" ? c : -c;
    });
  }, [people, query, sort]);

  function onSort(column: Column) {
    setSort((prev) =>
      prev.column === column ? { column, dir: prev.dir === "asc" ? "desc" : "asc" } : { column, dir: "asc" },
    );
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-4">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">Employees</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {syncedAt ? (
            <>
              <span className="font-medium text-foreground">{people.length.toLocaleString()} active employees</span>,
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

      <motion.div variants={riseChild} className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, title, department or manager"
            aria-label="Search employees"
            className="pl-9"
          />
        </div>
        {query.trim() && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {shown.length.toLocaleString()} of {people.length.toLocaleString()}
          </span>
        )}
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-240 text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-left text-[11px] text-muted-foreground">
                {COLUMNS.map(({ column, label }) => {
                  const active = sort.column === column;
                  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
                  return (
                    <th
                      key={column}
                      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                      className="px-5 py-2.5 font-medium"
                    >
                      <button
                        type="button"
                        onClick={() => onSort(column)}
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-1 whitespace-nowrap uppercase tracking-wider outline-none hover:text-foreground focus-visible:text-foreground",
                          active && "text-foreground",
                        )}
                      >
                        {label}
                        <Icon className={cn("size-3", !active && "opacity-40")} />
                      </button>
                    </th>
                  );
                })}
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
                    {people.length ? "No one matches." : "No employees."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>
    </motion.div>
  );
}
