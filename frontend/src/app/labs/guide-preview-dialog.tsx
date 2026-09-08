"use client";

/** Reads a guide without leaving the workshop being built. */

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, Eye, Loader2 } from "lucide-react";
import { LabGuideBody } from "@/components/lab-guide-body";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function GuidePreviewDialog({
  guide,
}: {
  guide: { id: string; slug: string; title: string };
}) {
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (html !== null) return;

    setError(null);
    try {
      const res = await fetch(`/api/lab-guides/${guide.id}/preview`);
      if (!res.ok) throw new Error(`Could not load the guide (${res.status})`);
      const data = await res.json();
      setHtml(data.html);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the guide");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          animate={false}
          aria-label={`Preview ${guide.title}`}
          title={`Preview ${guide.title}`}
        >
          <Eye />
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="pr-8">{guide.title}</DialogTitle>
          <DialogDescription>
            A preview of this guide as the room will read it.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto pr-2">
          {error ? (
            <p className="py-6 text-sm text-destructive">{error}</p>
          ) : html === null ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading…
            </p>
          ) : html.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              This guide has no content yet.
            </p>
          ) : (
            <LabGuideBody html={html} />
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button asChild variant="ghost">
            <Link href={`/labs/guides/${guide.slug}`} target="_blank">
              <ExternalLink />
              Open the full guide
            </Link>
          </Button>

          <DialogClose asChild>
            <Button type="button" variant="secondary" animate={false}>
              Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
