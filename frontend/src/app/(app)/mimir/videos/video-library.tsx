"use client";

/**
 * Every concept in the course, level by level and group by group, each with
 * its video and a link to where it sits on the map. A concept the coach has
 * marked as known shows "Mastered", and one it has asked you to watch is
 * flagged "Recommended".
 */

import "../map/map.css";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Star } from "lucide-react";
import { layoutMap } from "@/lib/mimir/map/layout";
import { NO_STATE, type ConceptState, type PublicMap } from "@/lib/mimir/map/schema";
import { cn } from "@/lib/utils";
import { PlayButton } from "../map/play-button";
import { VideoDialog } from "../map/video-dialog";

export function VideoLibrary({ map, states: initialStates, videos }: { map: PublicMap; states: Record<string, ConceptState>; videos: boolean }) {
  const full = useMemo(() => layoutMap(map), [map]);
  const byId = useMemo(() => new Map(full.concepts.map((c) => [c.id, c])), [full]);
  const [states, setStates] = useState(initialStates);
  const [playing, setPlaying] = useState<string | null>(null);
  const stateOf = (id: string) => states[id] ?? NO_STATE;
  const onState = useCallback((id: string, s: ConceptState) => setStates((prev) => ({ ...prev, [id]: s })), []);
  const groupBlurb = (id: string) => map.buckets.find((b) => b.id === id)?.blurb ?? "";

  return (
    <div className="mm space-y-4">
      {map.levels.map((l) => (
        <div key={l.level} className="space-y-3">
          <div>
            <h3 className="flex items-center text-lg font-semibold">
              <i className="mm-dot" style={{ background: `var(--l${l.level})` }} />
              {l.name}
            </h3>
            {l.blurb && <p className="text-sm text-muted-foreground">{l.blurb}</p>}
          </div>
          {full.groups
            .filter((g) => g.level === l.level)
            .map((g) => (
              <div key={g.index} className="space-y-2">
                <div>
                  <h4 className="text-[15px] font-semibold">
                    {g.name}
                    {g.sub ? ` (${g.sub})` : ""}
                  </h4>
                  {groupBlurb(g.id) && <p className="text-sm text-muted-foreground">{groupBlurb(g.id)}</p>}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {g.concepts.map((id) => {
                    const c = byId.get(id);
                    if (!c) return null;
                    const st = stateOf(c.id);
                    return (
                      <article
                        key={c.id}
                        className={cn("flex flex-col gap-2 rounded-xl border border-l-[5px] bg-card p-4", st.recommended && "border-[var(--flag)]")}
                        style={{ borderLeftColor: `var(--l${c.level})` }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h5 className="font-semibold">{c.name}</h5>
                          <div className="flex shrink-0 items-center gap-1.5 text-xs font-medium">
                            {st.mastered && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-400">
                                <Check className="size-3" strokeWidth={3} /> Mastered
                              </span>
                            )}
                            {st.recommended && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-700 dark:text-amber-400">
                                <Star className="size-3 fill-current" /> Recommended
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground tnum">
                          Study #{c.study} · {c.slides.length} {c.slides.length === 1 ? "slide" : "slides"}: {c.slides.join(", ")}
                        </p>
                        <div className="mt-auto flex flex-wrap items-center gap-3 pt-1">
                          <PlayButton concept={c} state={st} videos={videos} size={34} label="Play video" onPlay={setPlaying} />
                          <Link
                            href={`/mimir/map?show=${encodeURIComponent(c.id)}`}
                            className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                          >
                            Show on the map
                          </Link>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
      ))}

      {playing && byId.get(playing) && (
        <VideoDialog conceptId={playing} name={byId.get(playing)!.name} onClose={() => setPlaying(null)} onState={onState} />
      )}
    </div>
  );
}
