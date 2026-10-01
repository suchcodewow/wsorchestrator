"use client";

/** Everyone under the Organization Leader, as of the last HiBob sync. */

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Search, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { EvalsOrganizationMember } from "@/db/schema";
import { riseChild, staggerParent } from "@/lib/motion";

export function OrganizationTable({
  members,
  leaderEmail,
  leaderName,
  current,
}: {
  members: EvalsOrganizationMember[];
  leaderEmail: string | null;
  leaderName: string | null;
  current: boolean;
}) {
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) =>
      [m.fullName, m.email, m.title, m.department, m.reportsToName, m.reportsToEmail].some((v) =>
        v.toLowerCase().includes(q),
      ),
    );
  }, [members, query]);

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-4">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">Organization</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {leaderEmail ? (
            <>
              <span className="font-medium text-foreground">{members.length.toLocaleString()} people</span> report
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

      <motion.div variants={riseChild} className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, title or manager"
            aria-label="Search the organization"
            className="pl-9"
          />
        </div>
        {query.trim() && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {shown.length.toLocaleString()} of {members.length.toLocaleString()}
          </span>
        )}
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-200 text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Name</th>
                <th className="px-5 py-2.5 font-medium">Email</th>
                <th className="px-5 py-2.5 font-medium">Title</th>
                <th className="px-5 py-2.5 font-medium">Department</th>
                <th className="px-5 py-2.5 font-medium">Manager</th>
                <th className="px-5 py-2.5 font-medium">Links from leader</th>
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
                  <td className="px-5 py-2.5 tabular-nums text-muted-foreground">{m.depth}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                    {members.length ? "No one matches." : "No one reports up to the leader yet."}
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
