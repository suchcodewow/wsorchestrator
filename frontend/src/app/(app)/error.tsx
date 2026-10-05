"use client";

/**
 * A signed-in page whose server component threw. The shell stays, so the
 * sidebar still works; Try again re-fetches just this segment.
 */

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/5 px-5 py-6">
      <h1 className="flex items-center gap-2 text-lg font-medium">
        <AlertTriangle className="size-5 shrink-0 text-destructive" />
        This page could not load
      </h1>
      {/* Production hides the message; the digest is what matches it to the server log. */}
      {error.digest && (
        <p className="mt-1 text-sm text-muted-foreground">
          Reference <code className="font-mono">{error.digest}</code>
        </p>
      )}
      <Button variant="outline" className="mt-4" onClick={() => unstable_retry()}>
        <RefreshCw className="size-4" />
        Try again
      </Button>
    </section>
  );
}
