"use client";

/** The assessments, a page at a time, each opening to its editor. */

import Link from "next/link";
import { motion } from "framer-motion";
import { ClipboardPlus } from "lucide-react";
import {
  HEADER_ROW,
  LINK_ROW,
  Pager,
  PlainHeader,
  SortHeader,
  TableSearch,
  useRowLink,
} from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AUDIENCE_LABELS, STAGE_LABELS } from "@/lib/evals/assessment-values";
import type { AssessmentRow } from "@/lib/evals/assessments";
import type { AssessmentSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { formatWhen } from "../../cohort-settings/format";

export type AssessmentListing = Omit<AssessmentRow, "updatedAt"> & { updatedAt: string };

const COLUMNS: { column: AssessmentSort; label: string }[] = [
  { column: "name", label: "Name" },
  { column: "stage", label: "Session" },
  { column: "audience", label: "Group" },
  { column: "active", label: "Status" },
];

export function AssessmentsView({
  query,
  page,
  count,
}: {
  query: ListQuery<AssessmentSort>;
  page: Page<AssessmentListing>;
  count: number;
}) {
  const sortProps = { sort: query.sort, dir: query.dir };
  const rowLink = useRowLink();

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1.5">
          <h2 className="text-xl font-medium tracking-tight">Assessments</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">
              {count.toLocaleString()} {count === 1 ? "assessment" : "assessments"}
            </span>
          </p>
        </div>
        <Button variant="brand" asChild>
          <Link href="/evals-settings/assessments/new">
            <ClipboardPlus />
            New assessment
          </Link>
        </Button>
      </motion.div>

      <motion.div variants={riseChild}>
        <TableSearch value={query.q} placeholder="Search by name" label="Search assessments" />
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
                <PlainHeader>Criteria</PlainHeader>
                <PlainHeader>Scored</PlainHeader>
                <SortHeader column="updatedAt" {...sortProps}>
                  Updated
                </SortHeader>
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 3} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "No assessments match that search." : "No assessments yet."}
                  </td>
                </tr>
              )}
              {page.rows.map((a) => (
                <tr key={a.id} className={LINK_ROW} onClick={rowLink(`/evals-settings/assessments/${a.id}`)}>
                  <td className="px-5 py-3 font-medium">
                    <Link href={`/evals-settings/assessments/${a.id}`} className="group-hover:underline">
                      {a.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{STAGE_LABELS[a.stage]}</td>
                  <td className="px-5 py-3 text-muted-foreground">{AUDIENCE_LABELS[a.audience]}</td>
                  <td className="px-5 py-3">
                    <Badge variant={a.active ? "default" : "secondary"}>{a.active ? "Active" : "Inactive"}</Badge>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{a.criteria}</td>
                  <td className="px-5 py-3 text-muted-foreground">{a.submissions.toLocaleString()}</td>
                  <td className="px-5 py-3 text-muted-foreground">{formatWhen(a.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="assessments" />
        </div>
      </motion.div>
    </motion.div>
  );
}
