"use client";

/**
 * Carrying on from the item last opened, and starting over: every item back
 * to unopened, every conversation and takeaway gone.
 */

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MimirHeaderActions({ resume }: { resume: { id: string; title: string } | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const href = resume && `/mimir/library/${encodeURIComponent(resume.id)}`;

  async function startOver() {
    if (
      !window.confirm(
        "Start Mimir over? Every item goes back to not started, and your conversations with the coach and your takeaways are deleted. This can't be undone.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mimir/progress", { method: "DELETE" });
      if (!res.ok) throw new Error(res.status === 403 ? "You can't start over while viewing as someone else." : `Could not start over (${res.status}).`);
      router.push("/mimir/library");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start over.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {href && pathname !== href && (
          <Button variant="brand" size="sm" asChild>
            <Link href={href}>
              Continue: <span className="max-w-48 truncate">{resume.title}</span>
              <ArrowRight />
            </Link>
          </Button>
        )}
        {resume && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void startOver()}>
            {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            Start over
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
