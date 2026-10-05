"use client";

/** One stage's active assessments, each opening to the attendees it applies to. */

import Link from "next/link";
import { motion } from "framer-motion";
import {
  HEADER_ROW,
  LINK_ROW,
  Pager,
  PlainHeader,
  SortHeader,
  TableSearch,
  useRowLink,
} from "@/components/data-table";
import type { EvalsAssessmentStage } from "@/db/schema";
import { AUDIENCE_LABELS, STAGE_LABELS } from "@/lib/evals/assessment-values";
import type { AssessmentRow } from "@/lib/evals/assessments";
import type { AssessmentSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import type { ActiveBootcamp } from "@/lib/scheduler/bootcamps";
import { BootcampNotice } from "../bootcamp-notice";

type Listing = Omit<AssessmentRow, "updatedAt"> & { updatedAt: string };

export function StageView({
  stage,
  query,
  page,
  bootcamp,
}: {
  stage: EvalsAssessmentStage;
  query: ListQuery<AssessmentSort>;
  page: Page<Listing>;
  bootcamp: ActiveBootcamp | null;
}) {
  const sortProps = { sort: query.sort, dir: query.dir };
  const rowLink = useRowLink();

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">{STAGE_LABELS[stage]} assessments</h2>
        <BootcampNotice stage={stage} bootcamp={bootcamp} />
      </motion.div>

      <motion.div variants={riseChild}>
        <TableSearch value={query.q} placeholder="Search by name" label="Search assessments" />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-120 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                <SortHeader column="name" {...sortProps}>
                  Assessment
                </SortHeader>
                <SortHeader column="audience" {...sortProps}>
                  Group
                </SortHeader>
                <PlainHeader>Criteria</PlainHeader>
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "No assessments match that search." : "No active assessments for this session."}
                  </td>
                </tr>
              )}
              {page.rows.map((a) => (
                <tr key={a.id} className={LINK_ROW} onClick={rowLink(`/evals/${stage}/${a.id}`)}>
                  <td className="px-5 py-3 font-medium">
                    <Link href={`/evals/${stage}/${a.id}`} className="group-hover:underline">
                      {a.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{AUDIENCE_LABELS[a.audience]}</td>
                  <td className="px-5 py-3 text-muted-foreground">{a.criteria}</td>
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
