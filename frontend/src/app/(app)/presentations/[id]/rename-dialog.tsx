"use client";

/** Renames a presentation; the deck's title in Google is left alone. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PRESENTATION_LIMITS } from "@/db/schema";

export function RenameDialog({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/presentations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: value }),
      });
      if (!res.ok) {
        setError(`Could not rename it (${res.status}).`);
        return;
      }
      router.refresh();
      onClose();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename presentation</DialogTitle>
        </DialogHeader>
        <form
          id="rename-presentation"
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim() && !busy) void save();
          }}
        >
          <Input
            aria-label="Name"
            value={value}
            autoFocus
            disabled={busy}
            maxLength={PRESENTATION_LIMITS.name}
            onChange={(e) => setValue(e.target.value)}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="rename-presentation" disabled={busy || !value.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
