"use client";

/**
 * The fields a session and a session type share: kind, name, icon, color,
 * length and description. Used by Scheduler settings → Session types and by
 * the schedule's session dialog.
 */

import { ChevronDown, Minus, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioIconItem,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

/** A dropdown's button, drawn as an input. */
const TRIGGER =
  "flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none transition-colors hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

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
      <div role="radiogroup" aria-label="Kind" className="grid gap-2 sm:grid-cols-3">
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

      <div className="flex items-center gap-3">
        <span id={`${id}-length`} className="text-sm font-medium">
          Length
        </span>
        <div role="group" aria-labelledby={`${id}-length`} className="flex items-center rounded-md border">
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
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <span id={`${id}-emoji`} className="text-sm font-medium">
            Icon
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger aria-labelledby={`${id}-emoji`} className={TRIGGER}>
              {value.emoji ? <span className="text-base leading-none">{value.emoji}</span> : <span className="text-muted-foreground">No icon</span>}
              <ChevronDown className="ml-auto size-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-64">
              <DropdownMenuRadioGroup value={value.emoji} onValueChange={(e) => set("emoji", e)} className="grid grid-cols-8 gap-0.5">
                {SESSION_EMOJI.map((e) => (
                  <DropdownMenuRadioIconItem key={e} value={e} aria-label={`Icon ${e}`} className="size-8 text-base data-[state=checked]:bg-brand/10 data-[state=checked]:ring-1 data-[state=checked]:ring-brand-border">
                    {e}
                  </DropdownMenuRadioIconItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              {/* Keys typed here are the emoji's, not the menu's: no typeahead, no arrow-key moves. */}
              <Input
                aria-label="Any other emoji"
                value={SESSION_EMOJI.includes(value.emoji) ? "" : value.emoji}
                maxLength={SCHEDULE_LIMITS.emoji}
                placeholder="Or type or paste any emoji"
                onChange={(e) => set("emoji", e.target.value)}
                onKeyDown={(e) => e.key !== "Escape" && e.stopPropagation()}
                className="h-8"
              />
              {value.emoji && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => set("emoji", "")}>No icon</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="grid gap-1.5">
          <span id={`${id}-color`} className="text-sm font-medium">
            Color
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger aria-labelledby={`${id}-color`} className={TRIGGER}>
              <span className={cn("size-4 rounded-full", SESSION_STYLES[value.color].dot)} />
              {SESSION_STYLES[value.color].label}
              <ChevronDown className="ml-auto size-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
              <DropdownMenuRadioGroup value={value.color} onValueChange={(c) => set("color", c as SessionColor)}>
                {SESSION_COLORS.map((c) => (
                  <DropdownMenuRadioItem key={c} value={c}>
                    <span className={cn("size-4 rounded-full", SESSION_STYLES[c].dot)} />
                    {SESSION_STYLES[c].label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
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
