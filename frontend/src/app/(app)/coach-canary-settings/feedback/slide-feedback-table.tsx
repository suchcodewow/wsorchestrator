"use client";

/**
 * Coach Canary Feedback's ratings of slide review slides, the newest first, a
 * page at a time: when, who, the face, any comment, and the slide's theme and
 * seed. A row opens the slide rebuilt from its seed, mistakes marked, so the
 * comment can be read against what the person saw. Its sorting and paging
 * keep their own place in the address, apart from the concept table above it.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { HEADER_ROW, LINK_ROW, Pager, PlainHeader, SortHeader, useRowLink } from "@/components/data-table";
import { RATING_LABELS, RATING_TEXT_TONES, RatingFace } from "@/components/rating-face";
import type { SlideFeedbackSort } from "@/lib/list-specs";
import type { SlideFeedbackRow } from "@/lib/mimir/slide-feedback";
import { THEMES } from "@/lib/mimir/slide-review/bank";
import { riseChild } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { cn } from "@/lib/utils";
import { formatWhen } from "../../cohort-settings/format";
import { SeedButton, SlideSeedDialog } from "../slide-seed-dialog";

/** The address's prefix for this table's sort, direction and page. */
export const SLIDE_FEEDBACK_PREFIX = "slide";

const THEME_NAMES = new Map(THEMES.map((t) => [t.id, t.name]));

const COLUMNS: { column: SlideFeedbackSort; label: string }[] = [
  { column: "createdAt", label: "When" },
  { column: "user", label: "Person" },
  { column: "rating", label: "Rating" },
];

export function SlideFeedbackTable({ query, page }: { query: ListQuery<SlideFeedbackSort>; page: Page<SlideFeedbackRow> }) {
  const rowLink = useRowLink();
  const [seed, setSeed] = useState<number | null>(null);
  const sortProps = { sort: query.sort, dir: query.dir, prefix: SLIDE_FEEDBACK_PREFIX };

  return (
    <motion.section variants={riseChild} initial="hidden" animate="show" className="space-y-3">
      <h2 className="text-xl font-medium tracking-tight">Slide review feedback</h2>
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                {COLUMNS.map(({ column, label }) => (
                  <SortHeader key={column} column={column} {...sortProps}>
                    {label}
                  </SortHeader>
                ))}
                <PlainHeader>Comment</PlainHeader>
                <SortHeader column="theme" {...sortProps}>
                  Slide
                </SortHeader>
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                    No one has rated a slide yet.
                  </td>
                </tr>
              )}
              {page.rows.map((f) => {
                const open = () => setSeed(f.seed);
                return (
                  <tr key={f.id} className={LINK_ROW} onClick={rowLink(open)}>
                    <td className="px-5 py-3 whitespace-nowrap text-muted-foreground">
                      <button type="button" onClick={open} className="cursor-pointer text-left group-hover:underline">
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
                    <td className="max-w-md px-5 py-3">
                      {f.comment ? <span className="line-clamp-2">{f.comment}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <span className="mr-2">{THEME_NAMES.get(f.theme) ?? f.theme}</span>
                      <SeedButton seed={f.seed} onOpen={setSeed} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pager page={page} noun="ratings" prefix={SLIDE_FEEDBACK_PREFIX} />
      </div>
      <SlideSeedDialog seed={seed} onClose={() => setSeed(null)} />
    </motion.section>
  );
}
