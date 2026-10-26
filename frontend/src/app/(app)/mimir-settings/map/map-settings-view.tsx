"use client";

/**
 * Importing the concept map, and checking its videos. The map and what the
 * narrator says in each video are imported from a file, since the repository
 * is public and they are not; the videos themselves are uploaded to the
 * recordings bucket under mimir/videos/ (see docs/mimir.md). The list shows
 * which of them this environment has.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, TriangleAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatWhen } from "../../cohort-settings/format";
import { DeckPanel, type DeckDraft, type DeckJob } from "./deck-panel";

const ERRORS: Record<string, string> = {
  no_file: "Choose a file to import.",
  too_large: "That file is over 8 MB.",
  not_json: "That file isn't JSON.",
  invalid: "That file isn't a concept map",
};

type Video = { id: string; name: string; object: string; seconds: number; present: boolean | null };

function clock(seconds: number) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function MapSettingsView({
  summary,
  videos,
  studio,
}: {
  summary: { importedAt: string; concepts: number; slides: number } | null;
  videos: Video[];
  /** Mimir Studio's deck panel, for those who may run it. */
  studio: { configured: boolean; job: DeckJob | null; draft: DeckDraft | null } | null;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch("/api/mimir/map/import", { method: "POST", body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const where = body?.path ? ` (at ${body.path}: ${body.message})` : "";
        setMessage({ ok: false, text: `${ERRORS[body?.error ?? ""] ?? `Import failed (${res.status})`}${where}. Nothing was changed.` });
        return;
      }
      setMessage({ ok: true, text: `Imported ${body.concepts} concepts, ${body.videos} with a video.` });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "Could not reach the server." });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const missing = videos.filter((v) => v.present === false).length;
  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-2xl border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-medium tracking-tight">Concept map</h2>
        <p className="text-sm text-muted-foreground tnum">
          {summary ? (
            <>
              <span className="font-medium text-foreground">{summary.concepts}</span> concepts across {summary.slides} slides, {videos.length} with a video. Imported{" "}
              {formatWhen(summary.importedAt)}.
            </>
          ) : (
            <>Nothing imported yet.</>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={input}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <Loader2 className="animate-spin" /> : <Upload />}
            {summary ? "Replace the map" : "Import the map"}
          </Button>
          {message && (
            <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
              {message.text}
            </p>
          )}
        </div>
      </section>

      {studio && <DeckPanel {...studio} />}

      {videos.length > 0 && (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-3">
            <h2 className="font-medium">Videos</h2>
            <p className="text-sm text-muted-foreground tnum">
              {videos[0]!.present === null ? "This server has no bucket for videos." : missing === 0 ? `All ${videos.length} are in the bucket.` : `${missing} of ${videos.length} are missing from the bucket.`}
            </p>
          </div>
          <ul className="divide-y">
            {videos.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{v.name}</p>
                  <p className="truncate text-xs text-muted-foreground tnum">
                    {v.object} · {clock(v.seconds)}
                  </p>
                </div>
                {v.present === null ? (
                  <span className="text-xs text-muted-foreground">Not checked</span>
                ) : v.present ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    <Check className="size-3.5" strokeWidth={3} /> In the bucket
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
                    <TriangleAlert className="size-3.5" /> Missing
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
