"use client";

/**
 * Diagnostic Settings → Feedback: the ratings given while taking a test, the
 * newest first, a page at a time, searched by the comment, the question or
 * who gave it: when, who, the face, the comment, and the subject and question
 * that was on screen, as worded then. Each can be closed once dealt with, and
 * closed ones are hidden unless "Show closed" is ticked.
 */

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Check, Loader2, RotateCcw } from "lucide-react";
import { HEADER_ROW, Pager, PlainHeader, SortHeader, TableSearch } from "@/components/data-table";
import { RATING_LABELS, RATING_TEXT_TONES, RatingFace } from "@/components/rating-face";
import { Button } from "@/components/ui/button";
import { noticeDialog } from "@/components/ui/confirm";
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

export function FeedbackTable({
  query,
  showClosed,
  page,
}: {
  query: ListQuery<IrisFeedbackSort>;
  showClosed: boolean;
  page: Page<IrisFeedbackRow>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sortProps = { sort: query.sort, dir: query.dir };

  function toggleClosed(on: boolean) {
    const next = new URLSearchParams(searchParams.toString());
    if (on) next.set("closed", "1");
    else next.delete("closed");
    next.delete("page");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <motion.section variants={riseChild} initial="hidden" animate="show" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TableSearch value={query.q} placeholder="Search comments, questions and people" label="Search Diagnostic feedback" />
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(e) => toggleClosed(e.target.checked)}
            className="size-4 cursor-pointer accent-primary"
          />
          Show closed
        </label>
      </div>
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
                <PlainHeader>
                  <span className="sr-only">Close</span>
                </PlainHeader>
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q
                      ? "Nothing matches that search."
                      : showClosed
                        ? "No one has rated a question yet."
                        : "No open feedback."}
                  </td>
                </tr>
              )}
              {page.rows.map((f) => (
                <tr key={f.id} className={cn("border-b align-top last:border-0", f.closedAt && "text-muted-foreground")}>
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
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <CloseToggle feedback={f} />
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

/** Closes a rating, or opens a closed one again, then reloads the page so the list follows the checkbox. */
function CloseToggle({ feedback }: { feedback: IrisFeedbackRow }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const closed = feedback.closedAt !== null;
  const closer = feedback.closedBy ? feedback.closedBy.name || feedback.closedBy.email : null;

  async function toggle() {
    setPending(true);
    try {
      const res = await fetch(`/api/diagnostic/feedback/${feedback.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closed: !closed }),
      });
      if (!res.ok) throw new Error(`Could not save (${res.status})`);
      router.refresh();
    } catch (err) {
      await noticeDialog({
        title: closed ? "The feedback was not reopened" : "The feedback was not closed",
        description: err instanceof Error ? err.message : "Could not save",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" onClick={() => void toggle()} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : closed ? <RotateCcw /> : <Check />}
        {closed ? "Reopen" : "Close"}
      </Button>
      {closed && feedback.closedAt && (
        <span className="text-xs">
          Closed {formatWhen(feedback.closedAt)}
          {closer && ` by ${closer}`}
        </span>
      )}
    </div>
  );
}
