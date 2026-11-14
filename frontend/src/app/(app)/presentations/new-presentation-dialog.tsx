"use client";

/** Adds a presentation from a Google Slides link, reading its slides from Google before it opens. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PRESENTATION_LIMITS } from "@/db/schema";
import { slidesFileId } from "@/lib/presentations/link";

export function NewPresentationDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linkOk = slidesFileId(link) !== null;
  const ready = name.trim().length > 0 && linkOk;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/presentations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, link }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          body?.message ?? (body?.error === "invalid" ? "Give it a name and a Google Slides link." : `Could not add it (${res.status}).`),
        );
        return;
      }
      router.push(`/presentations/${body.id}`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New presentation</DialogTitle>
        </DialogHeader>

        <form
          id="new-presentation"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && !busy) void save();
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="presentation-link" className="text-sm font-medium">
              Google Slides link
            </label>
            <Input
              id="presentation-link"
              value={link}
              disabled={busy}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              placeholder="https://docs.google.com/presentation/d/…"
              onChange={(e) => setLink(e.target.value)}
              aria-invalid={link.trim() !== "" && !linkOk}
            />
            {link.trim() !== "" && !linkOk && <p className="text-sm text-destructive">That is not a Google Slides link.</p>}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="presentation-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="presentation-name"
              value={name}
              disabled={busy}
              maxLength={PRESENTATION_LIMITS.name}
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
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
          <Button type="submit" form="new-presentation" disabled={busy || !ready}>
            {busy ? "Reading the deck…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
