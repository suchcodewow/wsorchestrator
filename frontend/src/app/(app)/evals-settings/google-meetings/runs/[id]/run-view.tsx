"use client";

/**
 * What one Google Meetings sync did, or in a dry run would have: each person
 * it invited to an occurrence or took off one, whom Zoom saw join or miss,
 * and who has no occurrence left before their bootcamp. Filtered to the
 * invites, the attendance or the problems, with how many of each there are.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Info } from "lucide-react";
import { HEADER_ROW, Pager, PlainHeader, SortHeader, TableSearch } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import type { MeetingSyncAction } from "@/db/schema";
import type { MeetingChangeKind } from "@/lib/evals/google-meetings";
import type { MeetingSyncChangeSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { cn } from "@/lib/utils";
import { formatWhen } from "../../../../cohort-settings/format";
import { MeetingRunResult, type MeetingRun } from "../../google-meetings-view";

export type MeetingChangeListing = {
  id: string;
  meetingName: string;
  occurrenceStartsAt: string | null;
  action: MeetingSyncAction;
  email: string;
  fullName: string | null;
  detail: string | null;
  at: string;
};

const ACTIONS: Record<MeetingSyncAction, { live: string; dry: string }> = {
  invited: { live: "Invited", dry: "Would invite" },
  removed: { live: "Took off", dry: "Would take off" },
  attended: { live: "Attended", dry: "Attended" },
  missed: { live: "Missed", dry: "Missed" },
  none_left: { live: "None left before bootcamp", dry: "None left before bootcamp" },
  cancelled: { live: "Cancelled the old meeting", dry: "Would cancel the old meeting" },
  failed: { live: "Failed", dry: "Failed" },
};

const KINDS: { kind: MeetingChangeKind | null; label: string }[] = [
  { kind: null, label: "Everything" },
  { kind: "invites", label: "Invites" },
  { kind: "attendance", label: "Attendance" },
  { kind: "problems", label: "Problems" },
];

export function MeetingRunView({
  run,
  query,
  kind,
  counts,
  page,
}: {
  run: MeetingRun;
  query: ListQuery<MeetingSyncChangeSort>;
  kind: MeetingChangeKind | null;
  counts: Record<MeetingChangeKind | "all", number>;
  page: Page<MeetingChangeListing>;
}) {
  const sortProps = { sort: query.sort, dir: query.dir };
  const pathname = usePathname();
  const params = useSearchParams();

  /** This page with another filter, the search kept and back to its first page. */
  function kindHref(next: MeetingChangeKind | null) {
    const qs = new URLSearchParams(params.toString());
    qs.delete("page");
    if (next) qs.set("kind", next);
    else qs.delete("kind");
    const s = qs.toString();
    return s ? `${pathname}?${s}` : pathname;
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="space-y-2">
        <Link
          href="/evals-settings/google-meetings?view=runs"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Google Meetings
        </Link>
        <h2 className="flex flex-wrap items-center gap-2 text-xl font-medium tracking-tight">
          Sync of {formatWhen(run.startedAt)}
          {run.dryRun && <Badge variant="secondary">Dry run</Badge>}
          {run.testGroup && <Badge variant="outline">Test group</Badge>}
        </h2>
        <div className="space-y-1 text-sm">
          <p className="text-muted-foreground">
            {run.trigger === "schedule" ? "On the schedule" : `By ${run.triggeredBy ?? "someone since removed"}`}
            {run.dryRun && ": no invite was changed, and each row says what would have been"}
          </p>
          <MeetingRunResult run={run} />
        </div>
      </motion.div>

      {run.notes.length > 0 && (
        <motion.ul variants={riseChild} className="divide-y overflow-hidden rounded-2xl border bg-card text-sm shadow-sm">
          {run.notes.map((note) => (
            <li key={note} className="flex items-start gap-2 px-5 py-3 text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              {note}
            </li>
          ))}
        </motion.ul>
      )}

      <motion.div variants={riseChild} className="flex flex-wrap items-center gap-3">
        <nav aria-label="Show" className="inline-flex flex-wrap rounded-lg border bg-card p-0.5 shadow-xs">
          {KINDS.map(({ kind: k, label }) => (
            <Link
              key={label}
              href={kindHref(k)}
              scroll={false}
              aria-current={kind === k ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                kind === k ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              <span className="tabular-nums text-muted-foreground">{counts[k ?? "all"].toLocaleString()}</span>
            </Link>
          ))}
        </nav>
        <TableSearch
          value={query.q}
          placeholder="Search by meeting, person, action or detail"
          label="Search this run"
          className="min-w-56 flex-1"
        />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-180 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                <SortHeader column="action" {...sortProps}>
                  Action
                </SortHeader>
                <SortHeader column="meetingName" {...sortProps}>
                  Meeting
                </SortHeader>
                <SortHeader column="email" {...sortProps}>
                  Person
                </SortHeader>
                <PlainHeader>Detail</PlainHeader>
              </tr>
            </thead>
            <tbody>
              {page.rows.map((c) => (
                <tr key={c.id} className="border-b align-top last:border-b-0">
                  <td
                    className={cn(
                      "whitespace-nowrap px-5 py-2.5",
                      c.action === "failed" && "text-destructive",
                      c.action === "none_left" && "text-destructive",
                    )}
                  >
                    {ACTIONS[c.action][run.dryRun ? "dry" : "live"]}
                  </td>
                  <td className="px-5 py-2.5">
                    <span className="font-medium">{c.meetingName}</span>
                    {c.occurrenceStartsAt && (
                      <span className="block text-muted-foreground tabular-nums">{formatWhen(c.occurrenceStartsAt)}</span>
                    )}
                  </td>
                  <td className="px-5 py-2.5">
                    {c.email ? (
                      <>
                        <span className="font-medium">{c.fullName || c.email}</span>
                        {c.fullName && <span className="block text-muted-foreground">{c.email}</span>}
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="max-w-120 px-5 py-2.5 text-muted-foreground wrap-break-word">{c.detail ?? ""}</td>
                </tr>
              ))}
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q || kind
                      ? "Nothing matches."
                      : run.dryRun
                        ? "This run would have changed nothing."
                        : "This run changed nothing."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="changes" />
        </div>
      </motion.div>
    </motion.div>
  );
}
