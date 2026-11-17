"use client";

/**
 * The sessions of one daily survey's results, each a heading that opens: on
 * top, Claude's summary of it when one has been generated, then how many gave
 * it each rating, then every comment left on it with who left it. The
 * comments are fetched the first time a session is opened.
 */

import { useState } from "react";
import { ChevronRight, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SessionComment, SessionSummary } from "@/lib/surveys/surveys";
import { RATINGS, RATING_LABELS, formatAverage, surveySessionLine } from "@/lib/surveys/survey-values";

export function SessionAccordion({ surveyId, sessions }: { surveyId: string; sessions: SessionSummary[] }) {
  return (
    <div className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
      {sessions.map((s) => (
        <SessionRow key={s.id} surveyId={surveyId} session={s} />
      ))}
    </div>
  );
}

type Loaded = { comments: SessionComment[]; hasMore: boolean } | "error";

function SessionRow({ surveyId, session: s }: { surveyId: string; session: SessionSummary }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const detailsId = `session-${s.id}`;

  async function toggle() {
    setOpen((was) => !was);
    if (loaded || s.comments === 0) return;
    try {
      const res = await fetch(`/api/survey-results/${surveyId}/sessions/${s.id}/comments`);
      setLoaded(res.ok ? await res.json() : "error");
    } catch {
      setLoaded("error");
    }
  }

  return (
    <section>
      <div onClick={() => void toggle()} className="flex cursor-pointer items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/30">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailsId}
          aria-label={`${s.name} details`}
          onClick={(ev) => {
            ev.stopPropagation();
            void toggle();
          }}
          className="-mx-1 cursor-pointer rounded-md px-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {s.emoji && <span className="mr-1.5">{s.emoji}</span>}
            {s.name}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {surveySessionLine(s)} · {s.ratings} {s.ratings === 1 ? "rating" : "ratings"} · {s.comments}{" "}
            {s.comments === 1 ? "comment" : "comments"}
          </p>
        </div>
        <p className="shrink-0 text-xl font-medium tabular-nums">{formatAverage(s.average)}</p>
      </div>

      <div id={detailsId} hidden={!open} className="space-y-4 px-5 pb-5 pl-11">
        {s.summary && (
          <div className="space-y-1 rounded-xl border bg-muted/30 px-4 py-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Sparkles className="size-3.5" />
              AI summary
            </p>
            <p className="text-sm whitespace-pre-line">{s.summary}</p>
          </div>
        )}
        <Breakdown breakdown={s.breakdown} total={s.ratings} />
        <Comments session={s} loaded={loaded} />
      </div>
    </section>
  );
}

/** One bar per rating, 5 at the top, as wide as its share of the ratings. */
function Breakdown({ breakdown, total }: { breakdown: SessionSummary["breakdown"]; total: number }) {
  return (
    <div className="space-y-1.5" aria-label="Ratings">
      {[...RATINGS].reverse().map((r) => {
        const count = breakdown[r - 1] ?? 0;
        const share = total > 0 ? count / total : 0;
        return (
          <div key={r} className="flex items-center gap-3 text-xs">
            <span className="w-20 shrink-0 text-muted-foreground">
              {r}
              {RATING_LABELS[r] ? ` · ${RATING_LABELS[r]}` : ""}
            </span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${share * 100}%` }} />
            </div>
            <span className="w-16 shrink-0 text-right tabular-nums">
              {count} <span className="text-muted-foreground">({Math.round(share * 100)}%)</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Comments({ session: s, loaded }: { session: SessionSummary; loaded: Loaded | null }) {
  if (s.comments === 0) return <p className="text-sm text-muted-foreground">No comments.</p>;
  if (loaded === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Loading comments
      </p>
    );
  }
  if (loaded === "error") return <p className="text-sm text-destructive">Could not load the comments.</p>;
  return (
    <div className="divide-y overflow-hidden rounded-xl border">
      {loaded.comments.map((c) => (
        <div key={c.id} className="space-y-1 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium">
              {c.fullName || c.email}
              {c.fullName && <span className="ml-2 text-xs font-normal text-muted-foreground">{c.email}</span>}
            </p>
            <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums">{c.rating} / 5</span>
          </div>
          <p className="text-sm whitespace-pre-line">{c.feedback}</p>
        </div>
      ))}
      {loaded.hasMore && <p className="px-4 py-3 text-xs text-muted-foreground">Showing the first {loaded.comments.length}.</p>}
    </div>
  );
}
