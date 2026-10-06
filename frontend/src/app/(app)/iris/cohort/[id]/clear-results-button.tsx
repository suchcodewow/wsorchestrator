"use client";

/** Deletes every Iris sitting one person has, after saying so, so they can take the subjects again. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
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
      const res = await fetch(`/api/iris/cohort/${encodeURIComponent(userId)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Could not clear (${res.status})`);
      setOpen(false);
      router.push("/iris/cohort");
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
