"use client";

/**
 * Diagnostic Settings → Feedback: the ratings given while taking a test, the
 * newest first, a page at a time, searched by the comment, the question or
 * who gave it: when, who, the face, the comment, and the subject and question
 * that was on screen, as worded then.
 */

import { motion } from "framer-motion";
import { HEADER_ROW, Pager, PlainHeader, SortHeader, TableSearch } from "@/components/data-table";
import { RATING_LABELS, RATING_TEXT_TONES, RatingFace } from "@/components/rating-face";
import type { IrisFeedbackRow } from "@/lib/iris/feedback";
import { SUBJECTS } from "@/lib/iris/subjects";
import type { IrisFeedbackSort } from "@/lib/list-specs";
import { riseChild } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { cn } from "@/lib/utils";
import { formatWhen } from "../../cohort-settings/format";

const COLUMNS: { column: IrisFeedbackSort; label: string }[] = [
  { column: "createdAt", label: "When" },
  { column: "user", label: "Person" },
  { column: "rating", label: "Rating" },
];

export function FeedbackTable({ query, page }: { query: ListQuery<IrisFeedbackSort>; page: Page<IrisFeedbackRow> }) {
  const sortProps = { sort: query.sort, dir: query.dir };

  return (
    <motion.section variants={riseChild} initial="hidden" animate="show" className="space-y-3">
      <TableSearch value={query.q} placeholder="Search comments, questions and people" label="Search Diagnostic feedback" />
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-200 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                {COLUMNS.map(({ column, label }) => (
                  <SortHeader key={column} column={column} {...sortProps}>
                    {label}
                  </SortHeader>
                ))}
                <PlainHeader>Comment</PlainHeader>
                <SortHeader column="subject" {...sortProps}>
                  Question
                </SortHeader>
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "Nothing matches that search." : "No one has rated a question yet."}
                  </td>
                </tr>
              )}
              {page.rows.map((f) => (
                <tr key={f.id} className="border-b align-top last:border-0">
                  <td className="px-5 py-3 whitespace-nowrap text-muted-foreground">{formatWhen(f.createdAt)}</td>
                  <td className="max-w-48 truncate px-5 py-3">{f.user ? f.user.name || f.user.email : "Deleted account"}</td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      <RatingFace rating={f.rating} className={cn("size-4", RATING_TEXT_TONES[f.rating])} />
                      <span className="sr-only">{RATING_LABELS[f.rating]}</span>
                    </span>
                  </td>
                  <td className="max-w-sm px-5 py-3">
                    {f.comment ? (
                      <span className="whitespace-pre-wrap">{f.comment}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="max-w-md px-5 py-3">
                    <p className="text-xs text-muted-foreground">
                      {SUBJECTS[f.subject]?.name ?? f.subject} · <span className="tnum">Q{f.number}</span> ·{" "}
                      <span className="font-mono">{f.itemId}</span>
                      {f.mode === "preview" && " · Preview"}
                    </p>
                    <p className="mt-0.5 line-clamp-3" title={f.stem}>
                      {f.stem}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={page} noun="ratings" />
      </div>
    </motion.section>
  );
}
