"use client";

/**
 * A new slide deck, through Mimir Studio: the file goes from the browser
 * straight to the bucket, the studio reads every slide and drafts a new
 * concept map from it, and the draft waits here, with what it would change
 * and its slides, until it is published over the live map or discarded.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MIMIR_STUDIO_ACTIVE, type MimirStudioJobStatus } from "@/db/schema";
import { DECK_MAX_BYTES, type MapDiff } from "@/lib/mimir/studio/shapes";
import { formatWhen } from "../../cohort-settings/format";

const REFRESH_MS = 10_000;

const ERRORS: Record<string, string> = {
  invalid: "That file can't be read as a deck.",
  not_pptx: "Choose a PowerPoint file (.pptx).",
  not_configured: "This deployment has no Mimir Studio set up.",
  busy: "Another deck is already being read.",
  no_file: "The file didn't reach the bucket. Try again.",
  not_uploading: "That deck has already been started.",
  not_ready: "That draft is no longer waiting to be published.",
  not_found: "That deck is gone.",
};

export type DeckJob = {
  id: string;
  status: MimirStudioJobStatus;
  label: string;
  progress: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type DeckDraft = { summary: string; slides: { n: number; title: string }[]; diff: MapDiff };

const LEVEL_NAMES: Record<number, string> = { 1: "100", 2: "200", 3: "300", 4: "400" };

async function errorOf(res: Response, fallback: string) {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return ERRORS[body.error ?? ""] ?? `${fallback} (${res.status}).`;
}

/** PUTs the file to a signed URL, reporting how much has gone. */
function put(url: string, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`The bucket answered ${xhr.status}.`)));
    xhr.onerror = () => reject(new Error("The upload was cut off."));
    xhr.send(file);
  });
}

export function DeckPanel({ configured, job, draft }: { configured: boolean; job: DeckJob | null; draft: DeckDraft | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [sent, setSent] = useState<number | null>(null);
  const [pending, setPending] = useState<"publish" | "discard" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = Boolean(job && (MIMIR_STUDIO_ACTIVE as readonly string[]).includes(job.status));
  const waiting = job?.status === "ready" && draft;

  useEffect(() => {
    if (!active || sent !== null) return;
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [active, sent, router]);

  async function upload(file: File) {
    setError(null);
    if (!/\.pptx$/i.test(file.name)) return setError(ERRORS.not_pptx!);
    if (file.size > DECK_MAX_BYTES) return setError(`That file is over ${DECK_MAX_BYTES / 1024 / 1024} MB.`);
    setSent(0);
    try {
      const res = await fetch("/api/mimir/studio/decks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, bytes: file.size }),
      });
      if (!res.ok) throw new Error(await errorOf(res, "Couldn't start the upload"));
      const { job: made, uploadUrl } = (await res.json()) as { job: DeckJob; uploadUrl: string };
      await put(uploadUrl, file, setSent);
      const started = await fetch(`/api/mimir/studio/decks/${made.id}/start`, { method: "POST" });
      if (!started.ok) throw new Error(await errorOf(started, "Couldn't start reading the deck"));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't upload the deck.");
    } finally {
      setSent(null);
      if (input.current) input.current.value = "";
    }
  }

  async function act(what: "publish" | "discard") {
    if (!job) return;
    setPending(what);
    setError(null);
    try {
      const res = await fetch(`/api/mimir/studio/decks/${job.id}/${what}`, { method: "POST" });
      if (!res.ok) throw new Error(await errorOf(res, what === "publish" ? "Couldn't publish it" : "Couldn't discard it"));
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(null);
    }
  }

  const lostVideos = draft?.diff.removed.filter((c) => c.hadVideo).length ?? 0;
  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-lg font-medium tracking-tight">Slide deck</h2>
          {job && (
            <p className="truncate text-sm text-muted-foreground tnum">
              {job.label} · {statusLine(job)}
            </p>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        {!waiting && (
          <Button variant="outline" disabled={!configured || active || sent !== null} onClick={() => input.current?.click()}>
            {sent !== null || active ? <Loader2 className="animate-spin" /> : <Upload />}
            Upload a new deck
          </Button>
        )}
        {waiting && (
          <div className="flex gap-2">
            <Button variant="outline" disabled={pending !== null} onClick={() => void act("discard")}>
              {pending === "discard" ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Discard
            </Button>
            <Button disabled={pending !== null} onClick={() => setConfirming(true)}>
              <FileUp />
              Publish
            </Button>
          </div>
        )}
      </div>

      {!configured && <p className="px-5 py-4 text-sm text-muted-foreground">This deployment has no Mimir Studio set up.</p>}
      {sent !== null && (
        <div role="status" className="space-y-2 px-5 py-4">
          <p className="text-sm text-muted-foreground tnum">Uploading, {Math.round(sent * 100)}%</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${sent * 100}%` }} />
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="px-5 py-4 text-sm text-destructive">
          {error}
        </p>
      )}
      {job?.status === "failed" && job.error && !error && <p className="px-5 py-4 text-sm wrap-break-word text-destructive">{job.error}</p>}

      {waiting && (
        <div className="divide-y">
          <p className="px-5 py-4 text-sm whitespace-pre-line">{draft.summary}</p>
          <DiffRows diff={draft.diff} />
          <div className="px-5 py-4">
            <p className="mb-3 text-sm font-medium tnum">
              {draft.slides.length} slides{draft.diff.slides.was ? `, replacing ${draft.diff.slides.was}` : ""}
            </p>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {draft.slides.map((s) => (
                <li key={s.n} className="min-w-0">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a signed redirect to a private bucket, which next/image cannot optimize */}
                  <img
                    src={`/api/mimir/studio/decks/${job.id}/slides/${s.n}`}
                    alt={`Slide ${s.n}: ${s.title}`}
                    loading="lazy"
                    className="aspect-video w-full rounded-md border bg-muted object-contain"
                  />
                  <p className="mt-1 truncate text-xs text-muted-foreground tnum" title={s.title}>
                    {s.n}. {s.title}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish this deck?</DialogTitle>
            <DialogDescription>
              Its slides replace the map&apos;s and its concepts replace the map&apos;s concepts. Every concept it keeps keeps its video
              and everyone&apos;s progress.
              {draft && draft.diff.removed.length > 0 &&
                ` ${draft.diff.removed.length} ${draft.diff.removed.length === 1 ? "concept leaves" : "concepts leave"} the map${lostVideos ? `, ${lostVideos} with a video` : ""}.`}
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={pending !== null}>
              Cancel
            </Button>
            <Button onClick={() => void act("publish")} disabled={pending !== null}>
              {pending === "publish" && <Loader2 className="animate-spin" />}
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function statusLine(job: DeckJob): string {
  const when = job.finishedAt ? ` ${formatWhen(job.finishedAt)}` : "";
  switch (job.status) {
    case "uploading":
      return "uploading";
    case "queued":
    case "running":
      return job.progress ?? "starting";
    case "ready":
      return `read${when}, waiting to be published`;
    default:
      return `${job.status}${when}`;
  }
}

function DiffRows({ diff }: { diff: MapDiff }) {
  const groups = [
    { title: `${diff.added.length} new`, items: diff.added.map((c) => ({ id: c.id, text: c.name, note: LEVEL_NAMES[c.level] ?? "" })) },
    {
      title: `${diff.changed.length} changed`,
      items: diff.changed.map((c) => ({ id: c.id, text: c.was ? `${c.was} → ${c.name}` : c.name, note: c.what.join(", ") })),
    },
    { title: `${diff.removed.length} removed`, items: diff.removed.map((c) => ({ id: c.id, text: c.name, note: c.hadVideo ? "has a video" : "" })) },
  ].filter((g) => g.items.length > 0);
  return (
    <>
      <p className="px-5 py-4 text-sm text-muted-foreground tnum">
        {diff.added.length} new, {diff.changed.length} changed, {diff.removed.length} removed and {diff.unchanged} unchanged concepts.
      </p>
      {groups.map((g) => (
        <div key={g.title} className="px-5 py-4">
          <p className="mb-2 text-sm font-medium">{g.title}</p>
          <ul className="space-y-1 text-sm">
            {g.items.map((i) => (
              <li key={i.id} className="flex items-baseline justify-between gap-4">
                <span className="min-w-0 wrap-break-word">{i.text}</span>
                {i.note && <span className="shrink-0 text-xs text-muted-foreground tnum">{i.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}
