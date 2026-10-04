"use client";

/** The attendees one assessment applies to, each opening to their scoring form. */

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { HEADER_ROW, Pager, SortHeader, TableSearch } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { AUDIENCE_LABELS, STAGE_LABELS } from "@/lib/evals/assessment-values";
import type { AttendeeRow, ScoringAssessment } from "@/lib/evals/scoring";
import type { AssessmentAttendeeSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import type { ActiveBootcamp } from "@/lib/scheduler/bootcamps";
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
  page,
  counts,
}: {
  assessment: ScoringAssessment;
  bootcamp: ActiveBootcamp | null;
  query: ListQuery<AssessmentAttendeeSort>;
  page: Page<AttendeeRow>;
  counts: { attendees: number; scored: number };
}) {
  const sortProps = { sort: query.sort, dir: query.dir };
  const base = `/evals/${assessment.stage}/${assessment.id}`;

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
        </div>
      </motion.div>

      <motion.div variants={riseChild}>
        <TableSearch value={query.q} placeholder="Search by name, email or title" label="Search attendees" />
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
                    {query.q ? "No attendees match that search." : "Nobody in the cohort fits this assessment."}
                  </td>
                </tr>
              )}
              {page.rows.map((p) => (
                <tr key={p.id} className="border-b transition-colors last:border-b-0 hover:bg-muted/30">
                  <td className="px-5 py-3 font-medium">
                    <Link href={`${base}/${encodeURIComponent(p.id)}`} className="hover:underline">
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
