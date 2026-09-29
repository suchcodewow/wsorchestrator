"use client";

/** Everyone under the org root, with the list their title is on and their bootcamp dates. */

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { EvalsTitleList } from "@/db/schema";
import type { RosterPerson } from "@/lib/evals/roster";
import { TITLE_LIST_LABELS } from "@/lib/evals/title-lists";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { formatDate, formatHistoryDate, LIST_BADGE } from "../format";

type Filter = "all" | EvalsTitleList | "unlisted";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Everyone" },
  { value: "sales", label: "Sales" },
  { value: "engineer", label: "Engineer" },
  { value: "ignored", label: "Ignored" },
  { value: "unlisted", label: "No list" },
];

export function OrgTable({
  rootEmail,
  rootFound,
  people,
}: {
  rootEmail: string;
  rootFound: boolean;
  people: RosterPerson[];
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: people.length, sales: 0, engineer: 0, ignored: 0, unlisted: 0 };
    for (const p of people) c[p.list ?? "unlisted"]++;
    return c;
  }, [people]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((p) => {
      if (filter !== "all" && (p.list ?? "unlisted") !== filter) return false;
      if (!q) return true;
      return [p.fullName, p.email, p.title, p.reportsToName, p.department, p.site].some((v) =>
        v.toLowerCase().includes(q),
      );
    });
  }, [people, query, filter]);

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-4">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">Org</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {rootFound ? (
            <>
              <span className="font-medium text-foreground">{people.length.toLocaleString()} people</span> report
              up to <span className="font-mono">{rootEmail}</span>. A title on the{" "}
              <Link href="/evals-settings/sales-titles" className="underline underline-offset-4">
                Sales
              </Link>{" "}
              or{" "}
              <Link href="/evals-settings/engineer-titles" className="underline underline-offset-4">
                Engineer
              </Link>{" "}
              list gives its holder that role; one on the{" "}
              <Link href="/evals-settings/ignored-titles" className="underline underline-offset-4">
                Ignored
              </Link>{" "}
              list keeps them off the rosters.
            </>
          ) : (
            <span className="text-destructive">
              <span className="font-mono">{rootEmail}</span> is not among the imported employees, so no one is
              in the org.
            </span>
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
            placeholder="Search by name, email, title or manager"
            aria-label="Search the org"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by list">
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                filter === value
                  ? "border-foreground/20 bg-foreground/5 text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {label} <span className="tabular-nums text-muted-foreground">{counts[value]}</span>
            </button>
          ))}
        </div>
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-240 text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Person</th>
                <th className="px-5 py-2.5 font-medium">Title</th>
                <th className="px-5 py-2.5 font-medium">Manager</th>
                <th className="px-5 py-2.5 font-medium">Started</th>
                <th className="px-5 py-2.5 font-medium">In role since</th>
                <th className="px-5 py-2.5 font-medium">List</th>
                <th className="px-5 py-2.5 font-medium">BTC</th>
                <th className="px-5 py-2.5 font-medium">INT</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className="border-b transition-colors last:border-b-0 hover:bg-muted/30">
                  <td className="px-5 py-2.5">
                    <div className="font-medium">{p.fullName}</div>
                    <div className="text-xs text-muted-foreground">{p.email}</div>
                  </td>
                  <td className="px-5 py-2.5">
                    <div>{p.title || "—"}</div>
                    {p.department && <div className="text-xs text-muted-foreground">{p.department}</div>}
                  </td>
                  <td className="px-5 py-2.5 text-muted-foreground">{p.reportsToName || p.reportsToEmail || "—"}</td>
                  <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-muted-foreground">
                    {formatDate(p.startDate)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-muted-foreground">
                    {formatDate(p.activeEffectiveDate)}
                  </td>
                  <td className="px-5 py-2.5">
                    {p.list ? (
                      <Badge className={LIST_BADGE[p.list]}>{TITLE_LIST_LABELS[p.list]}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-2.5 tabular-nums">{formatHistoryDate(p.btcDate)}</td>
                  <td className="whitespace-nowrap px-5 py-2.5 tabular-nums">{formatHistoryDate(p.intDate)}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-muted-foreground">
                    No one matches.
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
