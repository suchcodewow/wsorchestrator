"use client";

/**
 * Diagnostic Settings → Grades: typed answers whose grade Claude was unsure
 * of, the oldest first, a page at a time, searched by the answer, the question
 * or who gave it. Each shows the question, what an expert would say, what the
 * person typed and why Claude graded it as it did; "Right" or "Wrong" decides
 * it. Decided ones are hidden unless "Show decided" is ticked, and can be
 * decided again.
 */

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Check, Loader2, X } from "lucide-react";
import { HEADER_ROW, Pager, PlainHeader, SortHeader, TableSearch } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { noticeDialog } from "@/components/ui/confirm";
import type { IrisGradeRow } from "@/lib/iris/grades";
import { SUBJECTS } from "@/lib/iris/subjects";
import type { IrisGradeSort } from "@/lib/list-specs";
import { riseChild } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { cn } from "@/lib/utils";
import { formatWhen } from "../../cohort-settings/format";

export function GradesTable({
  query,
  showDecided,
  page,
}: {
  query: ListQuery<IrisGradeSort>;
  showDecided: boolean;
  page: Page<IrisGradeRow>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sortProps = { sort: query.sort, dir: query.dir };

  function toggleDecided(on: boolean) {
    const next = new URLSearchParams(searchParams.toString());
    if (on) next.set("decided", "1");
    else next.delete("decided");
    next.delete("page");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <motion.section variants={riseChild} initial="hidden" animate="show" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TableSearch value={query.q} placeholder="Search answers, questions and people" label="Search Diagnostic grades" />
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showDecided}
            onChange={(e) => toggleDecided(e.target.checked)}
            className="size-4 cursor-pointer accent-primary"
          />
          Show decided
        </label>
      </div>
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-240 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                <SortHeader column="gradedAt" {...sortProps}>
                  When
                </SortHeader>
                <SortHeader column="user" {...sortProps}>
                  Person
                </SortHeader>
                <SortHeader column="subject" {...sortProps}>
                  Question
                </SortHeader>
                <PlainHeader>Their answer</PlainHeader>
                <PlainHeader>Grade</PlainHeader>
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q
                      ? "Nothing matches that search."
                      : showDecided
                        ? "No grade has needed a review yet."
                        : "No grades waiting on review."}
                  </td>
                </tr>
              )}
              {page.rows.map((g) => (
                <tr
                  key={`${g.attemptId}-${g.seq}`}
                  className={cn("border-b align-top last:border-b-0", g.reviewStatus !== "pending" && "text-muted-foreground")}
                >
                  <td className="px-5 py-3 whitespace-nowrap text-muted-foreground">{formatWhen(g.gradedAt)}</td>
                  <td className="max-w-48 truncate px-5 py-3">{g.user ? g.user.name || g.user.email : "Deleted account"}</td>
                  <td className="max-w-md px-5 py-3">
                    <p className="text-xs text-muted-foreground">
                      {SUBJECTS[g.subject]?.name ?? g.subject} · <span className="tnum">Q{g.seq}</span> ·{" "}
                      <span className="font-mono">{g.itemId}</span>
                    </p>
                    <p className="mt-0.5">{g.stem ?? "This question is no longer in the bank."}</p>
                    {g.expected && (
                      <p className="mt-1.5 text-xs">
                        <span className="font-medium text-muted-foreground">Expected:</span> {g.expected}
                      </p>
                    )}
                  </td>
                  <td className="max-w-sm px-5 py-3">
                    <p className="whitespace-pre-wrap">&ldquo;{g.answer}&rdquo;</p>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Claude: {g.gradedCorrect ? "right" : "wrong"}, unsure. {g.reason}
                    </p>
                  </td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <Decide grade={g} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={page} noun="grades" />
      </div>
    </motion.section>
  );
}

/** "Right" or "Wrong": the grade the answer deserves. The one already counting is marked. */
function Decide({ grade }: { grade: IrisGradeRow }) {
  const router = useRouter();
  const [pending, setPending] = useState<boolean | null>(null);
  const reviewer = grade.reviewedBy ? grade.reviewedBy.name || grade.reviewedBy.email : null;

  async function decide(correct: boolean) {
    setPending(correct);
    try {
      const res = await fetch(`/api/diagnostic/grades/${grade.attemptId}/${grade.seq}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correct }),
      });
      if (!res.ok) throw new Error(`Could not save (${res.status})`);
      router.refresh();
    } catch (err) {
      await noticeDialog({ title: "The grade was not saved", description: err instanceof Error ? err.message : "Could not save" });
    } finally {
      setPending(null);
    }
  }

  const decided = grade.reviewStatus !== "pending";
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {([true, false] as const).map((correct) => (
          <Button
            key={String(correct)}
            variant={decided && grade.correct === correct ? "brand" : "outline"}
            size="sm"
            onClick={() => void decide(correct)}
            disabled={pending !== null}
            aria-pressed={decided && grade.correct === correct}
          >
            {pending === correct ? <Loader2 className="animate-spin" /> : correct ? <Check /> : <X />}
            {correct ? "Right" : "Wrong"}
          </Button>
        ))}
      </div>
      {decided && grade.reviewedAt && (
        <span className="text-xs">
          {grade.reviewStatus === "overturned" ? "Overturned" : "Upheld"} {formatWhen(grade.reviewedAt)}
          {reviewer && ` by ${reviewer}`}
        </span>
      )}
    </div>
  );
}
