"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Workshop = { id: string; title: string };

/** Format a Date as the value a datetime-local input expects (local time). */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function CreateWorkshopDialog({
  open,
  onOpenChange,
  library,
  initialDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  library: Workshop[];
  initialDate: Date | null;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [workshopId, setWorkshopId] = useState(library[0]?.id ?? "");
  const [start, setStart] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form each time the dialog opens, defaulting the start time.
  useEffect(() => {
    if (!open) return;
    const base = initialDate ?? new Date();
    if (!initialDate) base.setHours(base.getHours() + 1, 0, 0, 0);
    else base.setHours(9, 0, 0, 0);
    setStart(toLocalInput(base));
    setName("");
    setWorkshopId(library[0]?.id ?? "");
    setError(null);
  }, [open, initialDate, library]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          workshopId,
          scheduledStart: new Date(start).toISOString(),
        }),
      });
      if (!res.ok) throw new Error(`Could not schedule (${res.status})`);
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not schedule");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule a workshop</DialogTitle>
          <DialogDescription>
            Pick a workshop and a start time. It provisions automatically when
            the time arrives.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-1.5">
            <label htmlFor="ws-name" className="text-sm font-medium">
              Workshop name
            </label>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Team onboarding — East"
              required
              autoFocus
            />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="ws-template" className="text-sm font-medium">
              Workshop
            </label>
            <select
              id="ws-template"
              value={workshopId}
              onChange={(e) => setWorkshopId(e.target.value)}
              required
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {library.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.title}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="ws-start" className="text-sm font-medium">
              Start date &amp; time
            </label>
            <Input
              id="ws-start"
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              required
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !workshopId}>
              {pending && <Loader2 className="animate-spin" />}
              {pending ? "Scheduling…" : "Schedule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
