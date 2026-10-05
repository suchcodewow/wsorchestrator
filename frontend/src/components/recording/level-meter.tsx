"use client";

/** How loud the microphone is right now, as a bar. */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** 0 to 1, about fifteen times a second; 0 with no stream. */
export function useAudioLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) return;
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    let frame = 0;
    let last = 0;
    const read = (t: number) => {
      frame = requestAnimationFrame(read);
      if (t - last < 66) return;
      last = t;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += s * s;
      const rms = Math.sqrt(sum / samples.length);
      // Speech sits around 0.02–0.2 RMS; a square root spreads it across the bar.
      setLevel(Math.min(1, Math.sqrt(rms * 5)));
    };
    frame = requestAnimationFrame(read);

    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void context.close();
      setLevel(0);
    };
  }, [stream]);

  return level;
}

export function LevelMeter({ level, className }: { level: number; className?: string }) {
  return (
    <div
      role="meter"
      aria-label="Microphone level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
      className={cn("h-2 overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className="h-full rounded-full bg-brand transition-[width] duration-75"
        style={{ width: `${Math.round(level * 100)}%` }}
      />
    </div>
  );
}
