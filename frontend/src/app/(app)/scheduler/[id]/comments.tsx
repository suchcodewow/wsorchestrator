"use client";

/**
 * A session's comments, newest first, each with who wrote it and when.
 * Loaded a page at a time; a manager can add one and remove their own.
 */

import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SCHEDULE_LIMITS } from "@/db/schema";
import type { CommentRow } from "@/lib/scheduler/comments";
import { formatWhen } from "../../cohort-settings/format";

type Loaded = { rows: CommentRow[]; page: number; hasMore: boolean };

export function Comments({
  bootcampId,
  sessionId,
  canWrite,
  viewerId,
  onChange,
}: {
  bootcampId: string;
  sessionId: string;
  canWrite: boolean;
  viewerId: string;
  onChange: () => void;
}) {
  const base = `/api/scheduler/bootcamps/${bootcampId}/sessions/${sessionId}/comments`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Page `page`, or an error to show. */
  const fetchPage = async (page: number): Promise<Loaded | string> => {
    try {
      const res = await fetch(`${base}?page=${page}`, { cache: "no-store" });
      const out = await res.json().catch(() => null);
      if (!res.ok) return `Could not load the comments (${res.status}).`;
      return { rows: out.comments, page, hasMore: out.hasMore };
    } catch {
      return "Could not reach the server.";
    }
  };

  useEffect(() => {
    let live = true;
    void fetchPage(1).then((got) => {
      if (!live) return;
      if (typeof got === "string") setError(got);
      else setLoaded(got);
    });
    return () => {
      live = false;
    };
    // The dialog remounts this for another session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  async function older(page: number) {
    setBusy("load");
    const got = await fetchPage(page);
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
      const res = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
      const out = await res.json().catch(() => null);
      if (!res.ok) return setError(`Could not add it (${res.status}).`);
      setLoaded((prev) => ({ rows: [out as CommentRow, ...(prev?.rows ?? [])], page: prev?.page ?? 1, hasMore: prev?.hasMore ?? false }));
      setDraft("");
      onChange();
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
      onChange();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="grid gap-3 border-t pt-5">
      <h3 className="text-sm font-medium">
        Comments
        {loaded && (
          <span className="ml-2 font-normal text-muted-foreground tabular-nums">
            {loaded.rows.length}
            {loaded.hasMore ? "+" : ""}
          </span>
        )}
      </h3>

      {canWrite && (
        <div className="grid gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={SCHEDULE_LIMITS.comment}
            rows={2}
            placeholder="Add a comment"
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
              <p className="mt-1 text-sm whitespace-pre-wrap">{c.body}</p>
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
