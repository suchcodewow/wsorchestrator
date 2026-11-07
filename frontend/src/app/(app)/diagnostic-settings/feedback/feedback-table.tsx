"use client";

/**
 * Diagnostic Settings → Feedback: the ratings given while taking a test, the
 * newest first, a page at a time, searched by the comment, the question or
 * who gave it: when, who, the face, the comment, and the subject and question
 * that was on screen, as worded then. A click on a row opens its answers: the
 * options, the correct one, and the one the person went on to choose. Each can
 * be closed once dealt with, and closed ones are hidden unless "Show closed" is
 * ticked.
 */

import { Fragment, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Check, ChevronRight, CircleCheck, Loader2, RotateCcw } from "lucide-react";
import { HEADER_ROW, LINK_ROW, Pager, PlainHeader, SortHeader, TableSearch, useRowLink } from "@/components/data-table";
import { RATING_LABELS, RATING_TEXT_TONES, RatingFace } from "@/components/rating-face";
import { Button } from "@/components/ui/button";
import { noticeDialog } from "@/components/ui/confirm";
import type { IrisFeedbackAnswers, IrisFeedbackRow } from "@/lib/iris/feedback";
import { SUBJECTS } from "@/lib/iris/subjects";
import type { IrisFeedbackSort } from "@/lib/list-specs";
import { riseChild } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { cn } from "@/lib/utils";
import { formatWhen } from "../../cohort-settings/format";

const LETTERS = ["A", "B", "C", "D"];

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
  const rowLink = useRowLink();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const sortProps = { sort: query.sort, dir: query.dir };

  function toggleRow(id: string) {
    setExpanded((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

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
              {page.rows.map((f) => {
                const open = expanded.has(f.id);
                const toggle = () => toggleRow(f.id);
                return (
                  <Fragment key={f.id}>
                    <tr
                      className={cn(
                        LINK_ROW,
                        "align-top",
                        open && "border-b-0 bg-muted/20",
                        f.closedAt && "text-muted-foreground",
                      )}
                      onClick={rowLink(toggle)}
                    >
                      <td className="px-5 py-3 whitespace-nowrap text-muted-foreground">
                        <button
                          type="button"
                          onClick={toggle}
                          aria-expanded={open}
                          className="inline-flex cursor-pointer items-center gap-1.5 text-left group-hover:underline"
                        >
                          <ChevronRight className={cn("size-4 shrink-0 transition-transform", open && "rotate-90")} />
                          {formatWhen(f.createdAt)}
                        </button>
                      </td>
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
                    {open && (
                      <tr className="border-b bg-muted/20 last:border-b-0">
                        <td colSpan={6} className="px-5 pt-1 pb-4">
                          <Answers stem={f.stem} answers={f.answers} sittingGone={f.attemptId === null} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
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

/**
 * A rated question's options in the bank's order, the correct one marked, and
 * the one the person chose when they answered it, which may be after rating it.
 * They saw the options shuffled, so the letters here are not the ones they saw.
 */
function Answers({ stem, answers, sittingGone }: { stem: string; answers: IrisFeedbackAnswers | null; sittingGone: boolean }) {
  if (!answers) return <p className="text-muted-foreground">This question is no longer in the bank.</p>;
  const { options, correct, chosen } = answers;
  const outcome =
    chosen === null
      ? sittingGone
        ? "Their sitting was reset, so their answer is gone."
        : "Not answered yet."
      : chosen === -1
        ? "They answered “I don’t know”."
        : chosen === correct
          ? "They chose the correct answer."
          : "They chose a wrong answer.";

  return (
    <div className="max-w-3xl space-y-2">
      <p className="font-medium text-foreground">{stem}</p>
      <div className="divide-y overflow-hidden rounded-lg border bg-card text-sm">
        {options.map((option, i) => {
          const isCorrect = i === correct;
          const isChosen = i === chosen;
          return (
            <div
              key={i}
              className={cn(
                "flex items-start gap-3 px-4 py-2.5",
                isChosen && !isCorrect && "bg-destructive/10",
                isCorrect && "bg-emerald-500/10",
              )}
            >
              <kbd
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-md border font-mono text-xs",
                  isCorrect ? "border-emerald-600 bg-emerald-600 text-white" : "bg-background text-muted-foreground",
                )}
              >
                {LETTERS[i]}
              </kbd>
              <span className="min-w-0 flex-1 pt-0.5 text-foreground">{option}</span>
              <span className="flex shrink-0 items-center gap-2 pt-0.5 text-xs">
                {isCorrect && (
                  <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                    <CircleCheck className="size-3.5" />
                    Correct
                  </span>
                )}
                {isChosen && (
                  <span className={cn("font-medium", isCorrect ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}>
                    Their answer
                  </span>
                )}
              </span>
            </div>
          );
        })}
        {chosen === -1 && (
          <div className="flex items-start gap-3 bg-destructive/10 px-4 py-2.5">
            <kbd className="flex size-6 shrink-0 items-center justify-center rounded-md border bg-background font-mono text-xs text-muted-foreground">
              E
            </kbd>
            <span className="min-w-0 flex-1 pt-0.5 text-foreground">I don&apos;t know</span>
            <span className="shrink-0 pt-0.5 text-xs font-medium text-destructive">Their answer</span>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {outcome}
        {answers.reworded && " The question has been reworded since, so these may not be the options they saw."}
      </p>
    </div>
  );
}
