/** A concept's play button: its progress ring, and a label beside it if one is given. Used on the map and in the video library. */

import type { PlacedConcept } from "@/lib/mimir/map/layout";
import { ringFraction, type ConceptState } from "@/lib/mimir/map/schema";
import { ProgressRing } from "./progress-ring";

export function PlayButton({
  concept: c,
  state: st,
  videos,
  size,
  label,
  onPlay,
}: {
  concept: PlacedConcept;
  state: ConceptState;
  /** Whether this server can play videos at all. */
  videos: boolean;
  size: number;
  label?: string;
  onPlay: (id: string) => void;
}) {
  if (!c.video) return null;
  const fraction = ringFraction(st, c.video.seconds);
  const pct = Math.round(fraction * 100);
  const what = st.completed ? "Watched. Play again" : pct > 0 ? `Resume (${pct}% watched)` : "Play video";
  return (
    <button
      type="button"
      className="mm-play"
      style={{ "--lc": `var(--l${c.level})` } as React.CSSProperties}
      disabled={!videos}
      title={videos ? what : "Videos aren't set up on this server"}
      aria-label={`${what}: ${c.name}`}
      onClick={(e) => {
        e.stopPropagation();
        onPlay(c.id);
      }}
    >
      <ProgressRing fraction={fraction} completed={st.completed} size={size} />
      {label && <span className="text-sm font-medium text-foreground">{label}</span>}
    </button>
  );
}
