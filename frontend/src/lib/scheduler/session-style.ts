/**
 * The classes each session color draws with, in light and dark. Spelled out in
 * full so Tailwind finds every one.
 */

import type { SessionColor } from "@/db/schema";

export type SessionStyle = {
  /** The card: a tinted fill, a border and a left stripe. */
  card: string;
  /** A swatch or a dot. */
  dot: string;
  label: string;
};

export const SESSION_STYLES: Record<SessionColor, SessionStyle> = {
  slate: {
    card: "border-slate-300/70 border-l-slate-400 bg-slate-50 dark:border-slate-700 dark:border-l-slate-500 dark:bg-slate-900/40",
    dot: "bg-slate-400",
    label: "Slate",
  },
  red: {
    card: "border-red-200 border-l-red-500 bg-red-50 dark:border-red-900/60 dark:border-l-red-500 dark:bg-red-950/40",
    dot: "bg-red-500",
    label: "Red",
  },
  orange: {
    card: "border-orange-200 border-l-orange-500 bg-orange-50 dark:border-orange-900/60 dark:border-l-orange-500 dark:bg-orange-950/40",
    dot: "bg-orange-500",
    label: "Orange",
  },
  amber: {
    card: "border-amber-200 border-l-amber-500 bg-amber-50 dark:border-amber-900/60 dark:border-l-amber-500 dark:bg-amber-950/40",
    dot: "bg-amber-500",
    label: "Amber",
  },
  green: {
    card: "border-green-200 border-l-green-500 bg-green-50 dark:border-green-900/60 dark:border-l-green-500 dark:bg-green-950/40",
    dot: "bg-green-500",
    label: "Green",
  },
  teal: {
    card: "border-teal-200 border-l-teal-500 bg-teal-50 dark:border-teal-900/60 dark:border-l-teal-500 dark:bg-teal-950/40",
    dot: "bg-teal-500",
    label: "Teal",
  },
  blue: {
    card: "border-blue-200 border-l-blue-500 bg-blue-50 dark:border-blue-900/60 dark:border-l-blue-500 dark:bg-blue-950/40",
    dot: "bg-blue-500",
    label: "Blue",
  },
  violet: {
    card: "border-violet-200 border-l-violet-500 bg-violet-50 dark:border-violet-900/60 dark:border-l-violet-500 dark:bg-violet-950/40",
    dot: "bg-violet-500",
    label: "Violet",
  },
  pink: {
    card: "border-pink-200 border-l-pink-500 bg-pink-50 dark:border-pink-900/60 dark:border-l-pink-500 dark:bg-pink-950/40",
    dot: "bg-pink-500",
    label: "Pink",
  },
};

/** The emoji offered beside a free-text one, in the session and session-type dialogs. */
export const SESSION_EMOJI = ["🧑‍🏫", "📝", "🎭", "🕰️", "🍔", "⏳", "☕", "💬", "🧠", "🎯", "🏆", "🛠️", "📊", "🎤", "🤝", "🚀"];

/** A session's left stripe alone, for the printed schedule, which spends ink on nothing else. */
export const PRINT_STRIPES: Record<SessionColor, string> = {
  slate: "border-l-slate-400",
  red: "border-l-red-500",
  orange: "border-l-orange-500",
  amber: "border-l-amber-500",
  green: "border-l-green-500",
  teal: "border-l-teal-500",
  blue: "border-l-blue-500",
  violet: "border-l-violet-500",
  pink: "border-l-pink-500",
};
