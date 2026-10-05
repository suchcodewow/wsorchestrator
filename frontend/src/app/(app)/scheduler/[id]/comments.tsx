"use client";

/**
 * A session's comments, newest first, each with who wrote it and when.
 * Loaded a page at a time; a manager can add one, tagging administrators and
 * the bootcamp's guest judges with "@", and remove their own.
 */

import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { MentionText } from "@/components/mention-text";
import { MentionTextarea } from "@/components/mention-textarea";
import { Button } from "@/components/ui/button";
import { SCHEDULE_LIMITS } from "@/db/schema";
import { mentionsIn, type MentionPick } from "@/lib/mentions";
import type { CommentRow } from "@/lib/scheduler/comments";
import { formatWhen } from "../../cohort-settings/format";

type Loaded = { rows: CommentRow[]; page: number; hasMore: boolean };
type CommentsPage = { comments: CommentRow[]; hasMore: boolean };

/** Page `page` of the comments at `base`, or an error to show. */
async function fetchPage(base: string, page: number): Promise<Loaded | string> {
  try {
    const res = await fetch(`${base}?page=${page}`, { cache: "no-store" });
    if (!res.ok) return `Could not load the comments (${res.status}).`;
    const out = (await res.json()) as CommentsPage;
    return { rows: out.comments, page, hasMore: out.hasMore };
  } catch {
    return "Could not reach the server.";
  }
}

export function Comments({
  bootcampId,
  sessionId,
  canWrite,
  viewerId,
  people,
  onChange,
}: {
  bootcampId: string;
  sessionId: string;
  canWrite: boolean;
  viewerId: string;
  /** Who a comment can tag. */
  people: MentionPick[];
  /** After one is added (1) or removed (-1). */
  onChange: (delta: number) => void;
}) {
  const base = `/api/scheduler/bootcamps/${bootcampId}/sessions/${sessionId}/comments`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState("");
  const [picks, setPicks] = useState<MentionPick[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void fetchPage(base, 1).then((got) => {
      if (!live) return;
      if (typeof got === "string") setError(got);
      else setLoaded(got);
    });
    return () => {
      live = false;
    };
  }, [base]);

  async function older(page: number) {
    setBusy("load");
    const got = await fetchPage(base, page);
    setBusy(null);
    if (typeof got === "string") return setError(got);
    setLoaded((prev) => ({ ...got, rows: [...(prev?.rows ?? []), ...got.rows] }));
  }

  async function post() {
    const body = draft.trim();
    if (!body) return;
    setBusy("post");
    setError(null);
    try {
      const mentions = mentionsIn(body, picks).map((p) => p.email);
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, mentions }),
      });
      const out = await res.json().catch(() => null);
      if (!res.ok) {
        return setError(
          out?.error === "not_instructor"
            ? `${out.email} is no longer an administrator or guest judge here, so cannot be tagged.`
            : `Could not add it (${res.status}).`,
        );
      }
      setLoaded((prev) => ({ rows: [out as CommentRow, ...(prev?.rows ?? [])], page: prev?.page ?? 1, hasMore: prev?.hasMore ?? false }));
      setDraft("");
      setPicks([]);
      onChange(1);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(c: CommentRow) {
    if (!window.confirm("Remove this comment?")) return;
    setBusy(c.id);
    setError(null);
    try {
      const res = await fetch(`${base}/${c.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) return setError(`Could not remove it (${res.status}).`);
      setLoaded((prev) => prev && { ...prev, rows: prev.rows.filter((r) => r.id !== c.id) });
      onChange(-1);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Comments" className="grid gap-3">
      {canWrite && (
        <div className="grid gap-2">
          <MentionTextarea
            value={draft}
            onChange={setDraft}
            people={people}
            onPick={(p) => setPicks((prev) => [...prev, p])}
            maxLength={SCHEDULE_LIMITS.comment}
            rows={2}
            placeholder="Add a comment — type @ to tag someone"
            aria-label="Add a comment"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void post();
              }
            }}
          />
          <div className="flex justify-end">
            <Button type="button" size="sm" variant="outline" disabled={!draft.trim() || busy === "post"} onClick={post}>
              {busy === "post" && <Loader2 className="animate-spin" />}
              Comment
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {!loaded ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : loaded.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : (
        <ul className="grid gap-3">
          {loaded.rows.map((c) => (
            <li key={c.id} className="group rounded-lg bg-muted/40 px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <div className="min-w-0 text-xs">
                  <span className="font-medium">{c.authorName || c.authorEmail || "Someone removed"}</span>
                  <span className="ml-2 text-muted-foreground">{formatWhen(String(c.createdAt))}</span>
                </div>
                {canWrite && c.authorId === viewerId && (
                  <button
                    type="button"
                    aria-label="Remove this comment"
                    disabled={busy === c.id}
                    onClick={() => remove(c)}
                    className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
              <p className="mt-1 text-sm whitespace-pre-wrap">
                <MentionText text={c.body} mentions={c.mentions} />
              </p>
            </li>
          ))}
        </ul>
      )}
      {loaded?.hasMore && (
        <Button type="button" variant="ghost" size="sm" className="justify-self-start" disabled={busy === "load"} onClick={() => older(loaded.page + 1)}>
          {busy === "load" && <Loader2 className="animate-spin" />}
          Older comments
        </Button>
      )}
    </section>
  );
}
