"use client";

/** The eight subjects, each to start, continue or already done, after the taker says which track they are in. */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, Circle, Lightbulb, Loader2, Lock, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MyIris, SubjectStatus } from "@/lib/iris/attempts";
import type { Level } from "@/lib/iris/engine";
import { TRACKS, TRACK_LABELS, type Track } from "@/lib/iris/subjects";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { LevelBadge } from "../level-badge";

const STATUS_ICON: Record<SubjectStatus, React.ReactNode> = {
  completed: <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />,
  in_progress: <PlayCircle className="size-5 text-brand" />,
  available: <Circle className="size-5 text-muted-foreground/60" />,
  unavailable: <Lock className="size-4.5 text-muted-foreground/50" />,
};

export function TestsView({ mine, selfId }: { mine: MyIris; selfId: string | null }) {
  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">Placement tests</h2>
        <p className="text-sm text-muted-foreground tnum">
          {mine.completed} of {mine.subjects.length} done
          {mine.track && <> · {TRACK_LABELS[mine.track]}</>}
        </p>
      </motion.div>

      <motion.div
        variants={riseChild}
        role="note"
        className="flex gap-3 rounded-2xl border border-brand/30 bg-brand-subtle/40 px-5 py-4 text-sm shadow-sm"
      >
        <Lightbulb className="mt-0.5 size-5 shrink-0 text-brand" />
        <div className="space-y-1">
          <p className="font-medium">Answer on your own: no AI, no search engine.</p>
          <p className="text-muted-foreground">
            Getting 100% with help from AI or Google doesn&apos;t help you. Your answers decide the prework
            you get, so answering truly honestly matches it to what you actually understand about each subject.
          </p>
        </div>
      </motion.div>

      {!mine.track && (
        <motion.div variants={riseChild}>
          <TrackPicker />
        </motion.div>
      )}

      <motion.div
        variants={riseChild}
        className={cn(
          "divide-y overflow-hidden rounded-2xl border bg-card text-sm shadow-sm",
          !mine.track && "pointer-events-none opacity-50",
        )}
        aria-disabled={!mine.track}
      >
        {mine.subjects.map((s) => (
          <div key={s.key} className="flex items-center gap-4 px-5 py-4">
            <span className="flex size-5 shrink-0 items-center justify-center">{STATUS_ICON[s.status]}</span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{s.name}</p>
              <p className="text-muted-foreground">{s.blurb}</p>
            </div>
            <SubjectAction subject={s.key} status={s.status} placement={s.placement} selfId={selfId} />
          </div>
        ))}
      </motion.div>

      <motion.p variants={riseChild} className="max-w-prose text-sm text-muted-foreground">
        Each subject is taken once and adapts to how you answer. &ldquo;I don&apos;t know&rdquo; is a real
        answer here, and there is no pass mark.
      </motion.p>
    </motion.div>
  );
}

function SubjectAction({
  subject,
  status,
  placement,
  selfId,
}: {
  subject: string;
  status: SubjectStatus;
  placement?: Level;
  selfId: string | null;
}) {
  if (status === "completed") {
    if (!placement || !selfId) return <span className="text-muted-foreground">Done</span>;
    return (
      <Link href={`/iris/cohort/${encodeURIComponent(selfId)}`} className="flex items-center gap-2 hover:underline">
        <LevelBadge level={placement} />
        <span className="text-xs text-muted-foreground">View path</span>
      </Link>
    );
  }
  if (status === "unavailable") return <span className="text-muted-foreground">Not open yet</span>;
  return (
    <Button asChild variant={status === "in_progress" ? "brand" : "outline"} size="sm">
      <Link href={`/iris/tests/${subject}`}>
        {status === "in_progress" ? "Continue" : "Start"}
        <ArrowRight />
      </Link>
    </Button>
  );
}

function TrackPicker() {
  const router = useRouter();
  const [saving, setSaving] = useState<Track | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(track: Track) {
    setSaving(track);
    setError(null);
    try {
      const res = await fetch("/api/iris/me/track", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track }),
      });
      if (!res.ok) throw new Error(`Could not save (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setSaving(null);
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-brand/30 bg-brand-subtle/40 p-5 shadow-sm">
      <p className="font-medium">Which role are you joining in?</p>
      <div className="flex flex-wrap gap-2">
        {TRACKS.map((t) => (
          <Button key={t} variant="outline" onClick={() => void choose(t)} disabled={saving !== null}>
            {saving === t && <Loader2 className="animate-spin" />}
            {TRACK_LABELS[t]}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
