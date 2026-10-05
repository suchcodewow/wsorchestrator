"use client";

/**
 * The Canary Wire exemptions set by hand. Bootcamp history already decides who
 * is accountable; a line here overrides it for one person. Saving re-reads the
 * month, with no new pull, because exemption is applied as a month is built.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const ERRORS: Record<string, string> = {
  invalid: "That list is too long to save.",
  too_many: "That lists more than 2,000 people.",
  forbidden: "Your own role changed — reload the page.",
};

export function ExemptionsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [count, setCount] = useState<number | null>(null);
  // Opened first, loaded second, so a failed request says so in the dialog
  // rather than leaving a button that does nothing. The parent remounts this
  // for each opening, so every one starts here.
  const [status, setStatus] = useState<string | null>("Loading…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    fetch("/api/evals/canary-wire/exemptions")
      .then(async (res) => {
        if (!res.ok) throw new Error(`the server returned ${res.status}`);
        const out = (await res.json()) as { text: string; exemptions: unknown[] };
        if (!live) return;
        setText(out.text);
        setCount(out.exemptions.length);
        setStatus(null);
      })
      .catch((err: Error) => live && setStatus(`Couldn't load the saved list — ${err.message}`));
    return () => {
      live = false;
    };
  }, [open]);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/evals/canary-wire/exemptions", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        // The dialog stays open so the pasted list isn't lost.
        setStatus(`Not saved — ${ERRORS[out.error ?? ""] ?? res.status}`);
        return;
      }
      onOpenChange(false);
      router.refresh();
    } catch {
      setStatus("Not saved — could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Bootcamp exemptions</DialogTitle>
          <DialogDescription>
            Bootcamp History decides who owes the Canary Wire: a rep counts from the month after their bootcamp. A line here
            overrides that for one person — <code>dana@harness.io</code> for not yet, or{" "}
            <code>dana@harness.io, August 2026</code> to count from August on.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          rows={9}
          aria-label="Exemptions, one email per line"
          placeholder={"rep@harness.io\nanother@harness.io, August 2026"}
          className="font-mono text-xs"
        />
        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {status ?? (count ? `${count} set by hand` : "None set by hand")}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="brand" disabled={busy || status === "Loading…"} onClick={save}>
              {busy && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
