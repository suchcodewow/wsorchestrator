"use client";

/**
 * Feedback on Mimir's videos: one row for each video that has any, with its
 * thumbs up and thumbs down and how many of each came with a comment. A row
 * opens to that video's feedback, in the order of the video; a line of it plays
 * the video from five seconds before that point. Whoever may moderate can also
 * edit a comment and accept or ignore it, and a video with accepted comments
 * offers Regenerate, which does nothing yet.
 */

import { Fragment, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Loader2, MessageSquare, Pencil, RefreshCw, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { HEADER_ROW, LINK_ROW, Pager, SortHeader, TableSearch, useRowLink } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { VIDEO_FEEDBACK_LIMITS, type VideoFeedbackStatus } from "@/db/schema";
import type { VideoFeedbackSummarySort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { formatDuration } from "@/lib/recording/format";
import type { VideoFeedbackRow, VideoFeedbackSummaryRow } from "@/lib/video-feedback";
import { cn } from "@/lib/utils";
import { formatWhen } from "../../cohort-settings/format";
import { FeedbackVideoDialog } from "./feedback-video-dialog";

/** How far before a comment its video opens. */
const LEAD_SECONDS = 5;

const COLUMNS: { column: VideoFeedbackSummarySort; label: string; className?: string }[] = [
  { column: "video", label: "Video" },
  { column: "up", label: "Thumbs up", className: "text-right" },
  { column: "upComments", label: "With comment", className: "text-right" },
  { column: "down", label: "Thumbs down", className: "text-right" },
  { column: "downComments", label: "With comment", className: "text-right" },
];

type Playing = { conceptId: string; name: string; startAt: number };

export function FeedbackView({
  query,
  page,
  canModerate,
}: {
  query: ListQuery<VideoFeedbackSummarySort>;
  page: Page<VideoFeedbackSummaryRow>;
  /** Whether the viewer may edit comments and accept or ignore them. */
  canModerate: boolean;
}) {
  const rowLink = useRowLink();
  const [open, setOpen] = useState<string | null>(null);
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const sortProps = { sort: query.sort, dir: query.dir };

  return (
    <motion.div variants={staggerParent(0.04)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild}>
        <h2 className="text-xl font-medium tracking-tight">Mimir Feedback</h2>
      </motion.div>

      <motion.div variants={riseChild}>
        <TableSearch value={query.q} placeholder="Search videos" label="Search videos" />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                {COLUMNS.map(({ column, label, className }) => (
                  <SortHeader key={column} column={column} {...sortProps} className={className}>
                    {label}
                  </SortHeader>
                ))}
                {canModerate && <th className="px-5 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + (canModerate ? 1 : 0)} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "Nothing matches that search." : "No one has rated a Mimir video yet."}
                  </td>
                </tr>
              )}
              {page.rows.map((r) => {
                const expanded = open === r.conceptId;
                const toggle = () => setOpen(expanded ? null : r.conceptId);
                return (
                  <Fragment key={r.conceptId}>
                    <tr className={LINK_ROW} onClick={rowLink(toggle)}>
                      <td className="max-w-md px-5 py-3 font-medium">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={toggle}
                          className="inline-flex cursor-pointer items-center gap-2 text-left group-hover:underline"
                        >
                          <ChevronRight className={cn("size-4 shrink-0 transition-transform", expanded && "rotate-90")} />
                          <span className="truncate">{r.label}</span>
                        </button>
                      </td>
                      <Count n={r.up} />
                      <Count n={r.upComments} />
                      <Count n={r.down} />
                      <Count n={r.downComments} />
                      {canModerate && (
                        <td className="px-5 py-3 text-right">
                          {r.accepted > 0 && (
                            <div className="flex flex-col items-end gap-1">
                              <Button variant="outline" size="sm" onClick={() => setRegenerating(r.conceptId)}>
                                <RefreshCw />
                                Regenerate
                              </Button>
                              {regenerating === r.conceptId && (
                                <span role="status" className="text-xs text-muted-foreground">
                                  Regenerating isn&apos;t built yet; nothing was changed.
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                    {expanded && (
                      <tr className="border-b bg-muted/20 last:border-b-0">
                        <td colSpan={COLUMNS.length + (canModerate ? 1 : 0)} className="p-0">
                          <Details
                            conceptId={r.conceptId}
                            canModerate={canModerate}
                            onPlay={(row) =>
                              setPlaying({
                                conceptId: r.conceptId,
                                name: r.label,
                                startAt: Math.max(0, row.positionSeconds - LEAD_SECONDS),
                              })
                            }
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="videos" />
        </div>
      </motion.div>

      {playing && <FeedbackVideoDialog {...playing} onClose={() => setPlaying(null)} />}
    </motion.div>
  );
}

function Count({ n }: { n: number }) {
  return <td className={cn("px-5 py-3 text-right tnum", n === 0 && "text-muted-foreground")}>{n.toLocaleString()}</td>;
}

type Loaded = { rows: VideoFeedbackRow[]; page: number; hasMore: boolean };

const STATUS_STYLES: Record<VideoFeedbackStatus, string> = {
  pending: "",
  accepted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  ignored: "bg-muted text-muted-foreground",
};

/** One video's feedback from its start to its end, fetched when the row opens and a page at a time after. */
function Details({
  conceptId,
  canModerate,
  onPlay,
}: {
  conceptId: string;
  canModerate: boolean;
  onPlay: (row: VideoFeedbackRow) => void;
}) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function fetchPage(page: number) {
    const params = new URLSearchParams({ kind: "mimir_concept", video: conceptId, sort: "position", dir: "asc", page: String(page) });
    return fetch(`/api/video-feedback?${params}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body: { feedback: VideoFeedbackRow[]; page: number; hasMore: boolean } = await res.json();
        setLoaded((prev) => ({ rows: [...(prev?.rows ?? []), ...body.feedback], page: body.page, hasMore: body.hasMore }));
      })
      .catch(() => setError("The feedback couldn't be loaded."))
      .finally(() => setBusy(false));
  }

  useEffect(() => {
    void fetchPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opened row
  }, []);

  function more() {
    setBusy(true);
    setError(null);
    void fetchPage(loaded!.page + 1);
  }

  /** A moderated row, as the server now has it; the counts above it are the page's to refresh. */
  function changed(row: VideoFeedbackRow) {
    setLoaded((prev) => prev && { ...prev, rows: prev.rows.map((r) => (r.id === row.id ? row : r)) });
    router.refresh();
  }

  return (
    <div className="divide-y">
      {loaded?.rows.map((f) => (
        <Line key={f.id} f={f} canModerate={canModerate} onPlay={() => onPlay(f)} onChanged={changed} />
      ))}
      {loaded?.rows.length === 0 && <p className="px-5 py-4 pl-11 text-sm text-muted-foreground">No feedback.</p>}
      {error && (
        <p role="alert" className="px-5 py-3 pl-11 text-sm text-destructive">
          {error}
        </p>
      )}
      {(busy || loaded?.hasMore) && (
        <div className="px-5 py-3 pl-11">
          {busy ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading feedback" />
          ) : (
            <Button variant="outline" size="sm" onClick={more}>
              Load more
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** One piece of feedback: it plays the video from just before it, and for a moderator its comment can be edited, accepted or ignored. */
function Line({
  f,
  canModerate,
  onPlay,
  onChanged,
}: {
  f: VideoFeedbackRow;
  canModerate: boolean;
  onPlay: () => void;
  onChanged: (row: VideoFeedbackRow) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(f.comment ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(change: { comment?: string; status?: VideoFeedbackStatus }) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/video-feedback/${encodeURIComponent(f.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body: { feedback: VideoFeedbackRow } = await res.json();
      setEditing(false);
      onChanged(body.feedback);
    } catch {
      setError("Couldn't save that.");
    } finally {
      setSaving(false);
    }
  }

  const play = {
    role: "button" as const,
    tabIndex: 0,
    onClick: onPlay,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onPlay();
      }
    },
  };

  return (
    <div className="flex items-start gap-4 px-5 py-3 pl-11 text-sm transition-colors hover:bg-muted/40">
      <span {...play} className="w-14 shrink-0 cursor-pointer font-mono text-xs text-muted-foreground tnum">
        {formatDuration(f.positionSeconds * 1000)}
      </span>
      {f.rating === "up" ? (
        <ThumbsUp aria-label="Thumbs up" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
      ) : (
        <ThumbsDown aria-label="Thumbs down" className="mt-0.5 size-4 shrink-0 text-red-600" />
      )}
      <div className="min-w-0 flex-1 space-y-2">
        {editing ? (
          <>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={VIDEO_FEEDBACK_LIMITS.comment}
              rows={3}
              aria-label="Comment"
            />
            <div className="flex gap-2">
              <Button size="sm" disabled={saving || !text.trim() || text.trim() === f.comment} onClick={() => void save({ comment: text.trim() })}>
                {saving ? <Loader2 className="animate-spin" /> : <Check />}
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  setEditing(false);
                  setText(f.comment ?? "");
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <span {...play} className="block cursor-pointer">
            {f.comment ? (
              <span className="flex items-start gap-1.5">
                <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="wrap-break-word whitespace-pre-wrap">{f.comment}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">No comment</span>
            )}
          </span>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      {f.comment !== null && f.status !== "pending" && (
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLES[f.status])}>
          {f.status === "accepted" ? "Accepted" : "Ignored"}
        </span>
      )}
      {canModerate && f.comment !== null && !editing && (
        <div className="flex shrink-0 gap-1">
          <Button size="icon" className="size-8" variant="ghost" aria-label="Edit comment" title="Edit comment" disabled={saving} onClick={() => setEditing(true)}>
            <Pencil />
          </Button>
          <Button
            size="icon" className="size-8"
            variant="ghost"
            aria-label={f.status === "accepted" ? "Clear acceptance" : "Accept comment"}
            title={f.status === "accepted" ? "Clear acceptance" : "Accept"}
            aria-pressed={f.status === "accepted"}
            disabled={saving}
            onClick={() => void save({ status: f.status === "accepted" ? "pending" : "accepted" })}
          >
            <Check className={f.status === "accepted" ? "text-emerald-600" : ""} />
          </Button>
          <Button
            size="icon" className="size-8"
            variant="ghost"
            aria-label={f.status === "ignored" ? "Clear ignore" : "Ignore comment"}
            title={f.status === "ignored" ? "Clear ignore" : "Ignore"}
            aria-pressed={f.status === "ignored"}
            disabled={saving}
            onClick={() => void save({ status: f.status === "ignored" ? "pending" : "ignored" })}
          >
            <X />
          </Button>
        </div>
      )}
      <span className="shrink-0 text-right text-xs text-muted-foreground">
        <span className="block">{f.user ? f.user.name || f.user.email || "Unknown" : "Deleted account"}</span>
        <span className="block whitespace-nowrap">{formatWhen(f.createdAt)}</span>
      </span>
    </div>
  );
}
