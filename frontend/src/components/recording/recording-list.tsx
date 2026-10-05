"use client";

/** The recordings this browser holds for one subject: play, download or delete each. */

import { useEffect, useState } from "react";
import { Download, Loader2, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { extensionFor, formatBytes, formatDuration } from "@/lib/recording/format";
import { deleteRecording, listRecordings, readRecording, type StoredRecording } from "@/lib/recording/store";

const startedLabel = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** `Dana Smith 2026-10-04 14-05.webm` */
function fileName(r: StoredRecording): string {
  const d = new Date(r.startedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
  return `${r.label.replace(/[\\/:*?"<>|]+/g, " ").trim()} ${stamp}.${extensionFor(r.mimeType)}`;
}

/** Lists afresh whenever `version` changes, so a parent bumps it after each recording. */
export function useRecordings(ownerId: string, subject: string, version: number) {
  const [recordings, setRecordings] = useState<StoredRecording[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listRecordings(ownerId, subject)
      .then((rows) => live && (setRecordings(rows), setError(null)))
      .catch((e: unknown) => {
        if (!live) return;
        setRecordings([]);
        setError(`This browser's saved recordings could not be read: ${(e as Error)?.message ?? "storage is unavailable"}.`);
      });
    return () => {
      live = false;
    };
  }, [ownerId, subject, version]);

  return { recordings, error };
}

export function RecordingList({
  recordings,
  onDeleted,
}: {
  recordings: StoredRecording[];
  onDeleted: () => void;
}) {
  if (recordings.length === 0) return null;
  return (
    <ul className="divide-y rounded-lg border">
      {recordings.map((r) => (
        <RecordingRow key={r.id} recording={r} onDeleted={onDeleted} />
      ))}
    </ul>
  );
}

function RecordingRow({ recording: r, onDeleted }: { recording: StoredRecording; onDeleted: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<"play" | "download" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  async function blobUrl(): Promise<string | null> {
    if (url) return url;
    const blob = await readRecording(r.id);
    if (!blob || blob.size === 0) {
      setError("Nothing was saved in this recording.");
      return null;
    }
    const made = URL.createObjectURL(blob);
    setUrl(made);
    return made;
  }

  async function act(kind: "play" | "download" | "delete") {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "delete") {
        if (!confirm("Delete this recording from this computer? It cannot be recovered.")) return;
        await deleteRecording(r.id);
        onDeleted();
        return;
      }
      const href = await blobUrl();
      if (href && kind === "download") {
        const a = document.createElement("a");
        a.href = href;
        a.download = fileName(r);
        a.click();
      }
    } catch (e) {
      setError((e as Error)?.message ?? "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="space-y-2 px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{startedLabel(r.startedAt)}</span>
        <span className="tabular-nums text-muted-foreground">
          {formatDuration(r.durationMs)} · {formatBytes(r.bytes)}
        </span>
        {r.status === "interrupted" && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">
            Interrupted — saved up to {formatDuration(r.durationMs)}
          </span>
        )}
        <div className="ml-auto flex gap-1">
          {!url && (
            <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => act("play")}>
              {busy === "play" ? <Loader2 className="animate-spin" /> : <Play />}
              Play
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => act("download")} aria-label="Download">
            {busy === "download" ? <Loader2 className="animate-spin" /> : <Download />}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => act("delete")} aria-label="Delete">
            {busy === "delete" ? <Loader2 className="animate-spin" /> : <Trash2 />}
          </Button>
        </div>
      </div>
      {url && <audio src={url} controls autoPlay className="h-9 w-full" />}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}
