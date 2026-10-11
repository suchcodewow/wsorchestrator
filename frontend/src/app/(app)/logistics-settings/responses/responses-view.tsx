"use client";

/**
 * One page of one intake form's responses, each person's latest, a column per
 * question as the form stands now. The search reaches the name, email and
 * every answer; the filter beside it narrows to one answer to one list
 * question.
 */

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { HEADER_ROW, Pager, PlainHeader, SortHeader, TableSearch } from "@/components/data-table";
import { INTAKE_FORM_IDS, type IntakeFormId, type IntakeQuestion } from "@/db/schema";
import type { IntakeResponseSort } from "@/lib/list-specs";
import { HAS_OPTIONS, INTAKE_FORM_LABELS } from "@/lib/logistics/intake-values";
import type { AnswerFilter, IntakeResponseRow } from "@/lib/logistics/responses";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { cn } from "@/lib/utils";

const SELECT = cn(
  "h-9 rounded-md border border-input bg-field px-2 text-sm text-foreground shadow-xs outline-none",
  "focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-wait disabled:opacity-50",
);

/** Sets or clears the form and the answer filter in the URL; back to page 1 either way. */
function useAnswerFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function set(filter: { form?: IntakeFormId; question: string; answer: string }) {
    const next = new URLSearchParams(params.toString());
    for (const key of ["form", "question", "answer"] as const) {
      if (key === "form" && filter.form === undefined) continue;
      const value = key === "form" && filter.form === "bootcamp" ? "" : filter[key];
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page");
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return { set, pending };
}

export function ResponsesView({
  form,
  questions,
  query,
  filter,
  page,
}: {
  form: IntakeFormId;
  questions: IntakeQuestion[];
  query: ListQuery<IntakeResponseSort>;
  filter: AnswerFilter | null;
  page: Page<IntakeResponseRow>;
}) {
  const { set, pending } = useAnswerFilter();
  const lists = questions.filter((q) => HAS_OPTIONS.has(q.kind));
  const chosen = lists.find((q) => q.id === filter?.question);

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="flex flex-wrap items-center gap-3">
        <select
          aria-label="Form"
          value={form}
          disabled={pending}
          onChange={(e) => set({ form: e.target.value as IntakeFormId, question: "", answer: "" })}
          className={SELECT}
        >
          {INTAKE_FORM_IDS.map((id) => (
            <option key={id} value={id}>
              {INTAKE_FORM_LABELS[id]}
            </option>
          ))}
        </select>
        <TableSearch
          value={query.q}
          placeholder="Search names, emails and answers"
          label="Search responses"
          className="min-w-56 flex-1"
        />
        <div role="group" aria-label="Filter by an answer" className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Question"
            value={chosen?.id ?? ""}
            disabled={pending}
            onChange={(e) => set({ question: e.target.value, answer: "" })}
            className={cn(SELECT, "max-w-64")}
          >
            <option value="">Any answer</option>
            {lists.map((q) => (
              <option key={q.id} value={q.id}>
                {q.title}
              </option>
            ))}
          </select>
          {chosen && (
            <select
              aria-label="Answer"
              value={filter?.answer ?? ""}
              disabled={pending}
              onChange={(e) => set({ question: chosen.id, answer: e.target.value })}
              className={cn(SELECT, "max-w-56")}
            >
              <option value="">Choose an answer</option>
              {chosen.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          )}
          {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                <SortHeader column="submittedAt" sort={query.sort} dir={query.dir}>
                  Saved
                </SortHeader>
                <SortHeader column="name" sort={query.sort} dir={query.dir}>
                  Name
                </SortHeader>
                <SortHeader column="email" sort={query.sort} dir={query.dir}>
                  Email
                </SortHeader>
                {questions.map((q) => (
                  <PlainHeader key={q.id} className="min-w-48 max-w-72">
                    <span title={q.title} className="line-clamp-2 normal-case tracking-normal">
                      {q.title}
                    </span>
                  </PlainHeader>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.rows.map((r) => (
                <tr key={r.id} className="border-b align-top last:border-b-0">
                  <td className="whitespace-nowrap px-5 py-3 text-muted-foreground tabular-nums">
                    {new Date(r.submittedAt).toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 font-medium">
                    {r.name ?? <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-5 py-3">{r.email}</td>
                  {questions.map((q) => {
                    const a = r.answers[q.id];
                    return (
                      <td key={q.id} className="max-w-72 px-5 py-3 whitespace-pre-line">
                        {a === undefined ? (
                          <span className="text-muted-foreground">—</span>
                        ) : Array.isArray(a) ? (
                          a.join(", ")
                        ) : (
                          a
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={questions.length + 3} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q || filter ? "No response matches that search and filter." : "No one has answered this form yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager page={page} noun="responses" />
      </motion.div>
    </motion.div>
  );
}
