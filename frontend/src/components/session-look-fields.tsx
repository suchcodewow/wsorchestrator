"use client";

/**
 * The fields a session and a session type share: kind, name, icon, color,
 * length and description. Used by Scheduler settings → Session types and by
 * the schedule's session dialog.
 */

import { Minus, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SCHEDULE_LIMITS, SESSION_COLORS, SESSION_KINDS, type SessionColor, type SessionKind } from "@/db/schema";
import { SESSION_EMOJI, SESSION_STYLES } from "@/lib/scheduler/session-style";
import { KIND_HINTS, KIND_LABELS, formatLength, snapMinutes } from "@/lib/scheduler/timeline";
import { cn } from "@/lib/utils";

export type SessionLook = {
  kind: SessionKind;
  name: string;
  emoji: string;
  color: SessionColor;
  minutes: number;
  description: string;
};

const LENGTH_PRESETS = [15, 30, 45, 60, 90, 120, 180];

export function SessionLookFields({
  id,
  value,
  onChange,
  autoFocus,
}: {
  /** Prefixes the inputs' ids. */
  id: string;
  value: SessionLook;
  onChange: (next: SessionLook) => void;
  autoFocus?: boolean;
}) {
  const set = <K extends keyof SessionLook>(key: K, v: SessionLook[K]) => onChange({ ...value, [key]: v });
  const step = (by: number) => set("minutes", snapMinutes(value.minutes + by));

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <span id={`${id}-kind`} className="text-sm font-medium">
          Kind
        </span>
        <div role="radiogroup" aria-labelledby={`${id}-kind`} className="grid gap-2 sm:grid-cols-3">
          {SESSION_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={value.kind === k}
              onClick={() => set("kind", k)}
              className={cn(
                "rounded-lg border px-3 py-2 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                value.kind === k ? "border-brand-border bg-brand/8" : "hover:border-brand-border/60 hover:bg-accent/40",
              )}
            >
              <div className="text-sm font-medium">{KIND_LABELS[k]}</div>
              <div className="text-xs leading-snug text-muted-foreground">{KIND_HINTS[k]}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor={`${id}-name`} className="text-sm font-medium">
          Name
        </label>
        <Input
          id={`${id}-name`}
          value={value.name}
          maxLength={SCHEDULE_LIMITS.name}
          onChange={(e) => set("name", e.target.value)}
          required
          autoFocus={autoFocus}
        />
      </div>

      <div className="grid gap-1.5">
        <span id={`${id}-length`} className="text-sm font-medium">
          Length
        </span>
        <div className="flex flex-wrap items-center gap-2" aria-labelledby={`${id}-length`}>
          <div className="flex items-center rounded-md border">
            <button
              type="button"
              aria-label="15 minutes shorter"
              disabled={value.minutes <= SCHEDULE_LIMITS.slot}
              onClick={() => step(-SCHEDULE_LIMITS.slot)}
              className="flex size-9 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <Minus className="size-3.5" />
            </button>
            <span className="tnum w-20 text-center text-sm font-medium" aria-live="polite">
              {formatLength(value.minutes)}
            </span>
            <button
              type="button"
              aria-label="15 minutes longer"
              disabled={value.minutes >= SCHEDULE_LIMITS.maxMinutes}
              onClick={() => step(SCHEDULE_LIMITS.slot)}
              className="flex size-9 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
          {LENGTH_PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => set("minutes", m)}
              className={cn(
                "rounded-md border px-2 py-1 text-xs tabular-nums transition-colors",
                value.minutes === m ? "border-brand-border bg-brand/8 text-foreground" : "text-muted-foreground hover:bg-accent",
              )}
            >
              {formatLength(m)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-emoji`} className="text-sm font-medium">
            Icon
          </label>
          <div className="flex flex-wrap gap-1">
            {SESSION_EMOJI.map((e) => (
              <button
                key={e}
                type="button"
                aria-label={`Icon ${e}`}
                aria-pressed={value.emoji === e}
                onClick={() => set("emoji", value.emoji === e ? "" : e)}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md border text-base transition-colors",
                  value.emoji === e ? "border-brand-border bg-brand/8" : "border-transparent hover:bg-accent",
                )}
              >
                {e}
              </button>
            ))}
          </div>
          <Input
            id={`${id}-emoji`}
            value={value.emoji}
            maxLength={SCHEDULE_LIMITS.emoji}
            placeholder="Or type or paste any emoji"
            onChange={(e) => set("emoji", e.target.value)}
            className="w-56"
          />
        </div>

        <div className="grid content-start gap-1.5">
          <span id={`${id}-color`} className="text-sm font-medium">
            Color
          </span>
          <div role="radiogroup" aria-labelledby={`${id}-color`} className="flex flex-wrap gap-1.5">
            {SESSION_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={value.color === c}
                aria-label={SESSION_STYLES[c].label}
                title={SESSION_STYLES[c].label}
                onClick={() => set("color", c)}
                className={cn(
                  "flex size-8 items-center justify-center rounded-full border-2 transition-colors",
                  value.color === c ? "border-foreground" : "border-transparent hover:border-border",
                )}
              >
                <span className={cn("size-5 rounded-full", SESSION_STYLES[c].dot)} />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor={`${id}-description`} className="text-sm font-medium">
          Description
        </label>
        <Textarea
          id={`${id}-description`}
          value={value.description}
          maxLength={SCHEDULE_LIMITS.description}
          rows={3}
          onChange={(e) => set("description", e.target.value)}
        />
      </div>
    </div>
  );
}
