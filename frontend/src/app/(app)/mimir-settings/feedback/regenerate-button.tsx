"use client";

/**
 * Has Mimir Studio make a concept's video again, taking in its accepted
 * comments, or make its first, after saying what that involves; and how the
 * latest such job stands.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MIMIR_STUDIO_ACTIVE } from "@/db/schema";
import type { StudioJobBrief } from "@/lib/mimir/studio/jobs";
import { formatWhen } from "../../cohort-settings/format";

const ERRORS: Record<string, string> = {
  busy: "A video for this concept is already being made.",
  not_found: "This concept is no longer on the map.",
  not_configured: "This deployment has no Mimir Studio set up.",
};

export const jobActive = (job: StudioJobBrief | null) => Boolean(job && (MIMIR_STUDIO_ACTIVE as readonly string[]).includes(job.status));

export function RegenerateButton({
  conceptId,
  name,
  hasVideo,
  accepted,
  job,
}: {
  conceptId: string;
  name: string;
  hasVideo: boolean;
  accepted: number;
  job: StudioJobBrief | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = jobActive(job);
  const offered = !hasVideo || accepted > 0;

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/mimir/studio/concepts/${encodeURIComponent(conceptId)}/regenerate`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(ERRORS[body.error ?? ""] ?? `Couldn't start it (${res.status}).`);
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start it.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1" onClick={(e) => e.stopPropagation()}>
      {(offered || active) && (
        <Button variant="outline" size="sm" disabled={active} onClick={() => setOpen(true)}>
          {active ? <Loader2 className="animate-spin" /> : hasVideo ? <RefreshCw /> : <Sparkles />}
          {hasVideo ? "Regenerate" : "Generate"}
        </Button>
      )}
      <JobLine job={job} />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{hasVideo ? `Regenerate “${name}”?` : `Generate a video for “${name}”?`}</DialogTitle>
            <DialogDescription>
              Claude writes the script and scenes by the explainer standards, ElevenLabs narrates them, and the video
              is rendered and put on the map in place of {hasVideo ? "the current one" : "the empty slot"}. It takes up
              to an hour and spends Claude and ElevenLabs credits.
              {accepted > 0 &&
                ` The ${accepted} accepted ${accepted === 1 ? "comment goes" : "comments go"} with it, each with where in the video it was made, and ${accepted === 1 ? "is" : "are"} marked applied once the new video is up.`}
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {hasVideo ? "Regenerate" : "Generate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function JobLine({ job }: { job: StudioJobBrief | null }) {
  if (!job) return null;
  if (jobActive(job))
    return (
      <span role="status" className="max-w-64 text-right text-xs text-muted-foreground">
        {job.progress ?? "Starting…"}
      </span>
    );
  if (job.status === "failed")
    return (
      <span className="max-w-64 text-right text-xs text-destructive" title={job.error ?? undefined}>
        Failed {job.finishedAt && formatWhen(job.finishedAt)}
      </span>
    );
  if (job.status === "succeeded" && job.finishedAt)
    return <span className="text-right text-xs text-muted-foreground">Made {formatWhen(job.finishedAt)}</span>;
  return null;
}
