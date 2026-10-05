"use client";

/**
 * The attendees one assessment applies to, each opening to their scoring
 * form. Assigned to me narrows them to the viewer's own groups in the active
 * bootcamp's breakouts that are scored on this assessment.
 */

import { useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, DoorOpen, UserCheck } from "lucide-react";
import { HEADER_ROW, LINK_ROW, Pager, SortHeader, TableSearch, useRowLink } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { AUDIENCE_LABELS, STAGE_LABELS } from "@/lib/evals/assessment-values";
import type { AttendeeRow, BreakoutRoom, ScoringAssessment } from "@/lib/evals/scoring";
import type { AssessmentAttendeeSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import type { ActiveBootcamp } from "@/lib/scheduler/bootcamps";
import { formatClock } from "@/lib/scheduler/timeline";
import { cn } from "@/lib/utils";
import { formatScore } from "../../../cohort-settings/format";
import { BootcampNotice } from "../../bootcamp-notice";

const COLUMNS: { column: AssessmentAttendeeSort; label: string }[] = [
  { column: "fullName", label: "Name" },
  { column: "email", label: "Email" },
  { column: "title", label: "Title" },
  { column: "track", label: "Track" },
  { column: "averageScore", label: "Score" },
];

const TRACK_LABELS = { sales: "Sales", engineer: "Engineer" } as const;

export function AttendeesView({
  assessment,
  bootcamp,
  query,
  mine,
  page,
  counts,
  rooms,
}: {
  assessment: ScoringAssessment;
  bootcamp: ActiveBootcamp | null;
  query: ListQuery<AssessmentAttendeeSort>;
  /** Whether only the viewer's own breakout groups are shown. */
  mine: boolean;
  page: Page<AttendeeRow>;
  /** `mine` is how many are in the viewer's breakout groups, whatever is shown. */
  counts: { attendees: number; scored: number; mine: number };
  /** The viewer's rooms in the breakouts scored on this assessment. */
  rooms: BreakoutRoom[];
}) {
  const sortProps = { sort: query.sort, dir: query.dir };
  const base = `/evals/${assessment.stage}/${assessment.id}`;
  const rowLink = useRowLink();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  /** Shows only the viewer's groups, or everyone again; back to page 1 either way. */
  function toggleMine() {
    const next = new URLSearchParams(params.toString());
    if (mine) next.delete("mine");
    else next.set("mine", "1");
    next.delete("page");
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="space-y-4">
        <Link
          href={`/evals/${assessment.stage}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {STAGE_LABELS[assessment.stage]} assessments
        </Link>
        <div className="space-y-1.5">
          <h2 className="text-xl font-medium tracking-tight">{assessment.name}</h2>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {counts.scored.toLocaleString()} of {counts.attendees.toLocaleString()}
            </span>{" "}
            {AUDIENCE_LABELS[assessment.audience].toLowerCase()} {counts.attendees === 1 ? "attendee" : "attendees"} scored
          </p>
          <BootcampNotice stage={assessment.stage} bootcamp={bootcamp} />
          {rooms.map((r) => (
            <p key={`${r.track}:${r.day}:${r.start}`} className="flex items-center gap-2 text-sm text-muted-foreground">
              <DoorOpen className="size-4 shrink-0" />
              <span>
                Your room is <span className="font-medium text-foreground">{r.roomName}</span> for {r.sessionName}, Day{" "}
                {r.day} at {formatClock(r.start)}
              </span>
            </p>
          ))}
        </div>
      </motion.div>

      <motion.div variants={riseChild} className="flex flex-wrap items-center gap-3">
        <TableSearch
          value={query.q}
          placeholder="Search by name, email or title"
          label="Search attendees"
          className="min-w-56 flex-1"
        />
        {bootcamp && (
          <button
            type="button"
            title="Only the attendees in your groups in the breakouts on the schedule scored on this assessment"
            aria-pressed={mine}
            disabled={pending}
            onClick={toggleMine}
            className={cn(
              "inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-sm shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-wait",
              mine
                ? "border-brand-border bg-brand-subtle text-foreground"
                : "bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <UserCheck className={cn("size-4", mine && "text-brand")} />
            Assigned to me
            <span className="font-medium tabular-nums text-foreground">{counts.mine.toLocaleString()}</span>
          </button>
        )}
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                {COLUMNS.map(({ column, label }) => (
                  <SortHeader key={column} column={column} {...sortProps}>
                    {label}
                  </SortHeader>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q
                      ? "No attendees match that search."
                      : mine
                        ? "Nobody is assigned to you in a breakout scored on this assessment."
                        : "Nobody in the cohort fits this assessment."}
                  </td>
                </tr>
              )}
              {page.rows.map((p) => (
                <tr key={p.id} className={LINK_ROW} onClick={rowLink(`${base}/${encodeURIComponent(p.id)}`)}>
                  <td className="px-5 py-3 font-medium">
                    <Link href={`${base}/${encodeURIComponent(p.id)}`} className="group-hover:underline">
                      {p.fullName}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{p.email}</td>
                  <td className="px-5 py-3 text-muted-foreground">{p.title || "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground">{TRACK_LABELS[p.track]}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className={p.averageScore === null ? "text-muted-foreground" : "font-medium"}>
                        {formatScore(p.averageScore)}
                      </span>
                      {p.needsRescoring && <Badge variant="outline">Needs rescoring</Badge>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="attendees" />
        </div>
      </motion.div>
    </motion.div>
  );
}
