"use client";

/** A placement in the Records table that opens a menu to reset that subject, after asking. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { confirmDialog, noticeDialog } from "@/components/ui/confirm";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Form, Level } from "@/lib/iris/engine";
import { LEVEL_LABELS, SUBJECTS, type SubjectKey } from "@/lib/iris/subjects";
import { LevelBadge } from "@/app/(app)/diagnostic/level-badge";

export function ScoreMenu({
  userId,
  subject,
  form,
  level,
  who,
}: {
  userId: string;
  subject: SubjectKey;
  form: Form;
  level: Level;
  who: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const name = SUBJECTS[subject].name;

  async function reset() {
    const ok = await confirmDialog({
      title: `Reset ${who}'s ${name} score?`,
      description: `Their ${LEVEL_LABELS[level]} sitting and its answers are deleted, so they can take ${name} again. This cannot be undone.`,
      confirmLabel: "Reset",
      destructive: true,
    });
    if (!ok) return;
    setPending(true);
    try {
      const res = await fetch(`/api/diagnostic/results/${encodeURIComponent(userId)}/${subject}?form=${form}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Could not reset (${res.status})`);
      router.refresh();
    } catch (err) {
      await noticeDialog({
        title: "The score was not reset",
        description: err instanceof Error ? err.message : "Could not reset",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={pending}
        aria-label={`${name}: ${LEVEL_LABELS[level]}`}
        className="cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
      >
        <LevelBadge level={level} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>
          {name} · {LEVEL_LABELS[level]}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={reset} className="text-destructive focus:text-destructive">
          <RotateCcw />
          Reset score
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
