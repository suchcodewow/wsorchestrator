"use client";

/**
 * Deletes every Diagnostic sitting one person has, or one subject's, after
 * saying so, so they can take the subjects again.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmDialog, noticeDialog } from "@/components/ui/confirm";
import type { Form } from "@/lib/iris/engine";
import { SUBJECTS, type SubjectKey } from "@/lib/iris/subjects";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function ClearResultsButton({ userId, who, sittings }: { userId: string; who: string; sittings: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/diagnostic/results/${encodeURIComponent(userId)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Could not clear (${res.status})`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={sittings === 0}>
        <RotateCcw />
        Clear results
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear {who}&apos;s results?</DialogTitle>
            <DialogDescription>
              {sittings} {sittings === 1 ? "sitting" : "sittings"} and every answer in them are deleted, on every
              form, so they can take each subject again. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void submit()} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {pending ? "Clearing…" : "Clear results"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Resets one subject, after asking, so the person can come back and take it again. */
export function ResetTestButton({ userId, subject, form, who }: { userId: string; subject: SubjectKey; form: Form; who: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const name = SUBJECTS[subject].name;

  async function reset() {
    const ok = await confirmDialog({
      title: `Reset ${who}'s ${name} test?`,
      description: `Their sitting and every answer in it are deleted, so they can take ${name} again from the start. Their other subjects are kept. This cannot be undone.`,
      confirmLabel: "Reset test",
      destructive: true,
    });
    if (!ok) return;
    setPending(true);
    try {
      const res = await fetch(
        `/api/diagnostic/results/${encodeURIComponent(userId)}/${subject}?form=${form}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`Could not reset (${res.status})`);
      router.refresh();
    } catch (err) {
      await noticeDialog({ title: "The test was not reset", description: err instanceof Error ? err.message : "Could not reset" });
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant="outline" size="sm" className="ml-auto" disabled={pending} onClick={() => void reset()}>
      {pending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
      Reset test
    </Button>
  );
}
