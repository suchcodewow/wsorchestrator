"use client";

/**
 * Logs who releasing a class would message in Slack, and what it would say,
 * without releasing it or sending anything, then opens that log.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { STAGE_LABELS } from "@/lib/evals/assessment-values";
import type { ReleaseStage } from "@/lib/reporting/bootcamp-values";
import { Hint } from "./hint";

export function PreviewButton({ stage }: { stage: ReleaseStage }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function preview() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/reporting/release-notices/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.runId) {
        setError(`Could not preview (${res.status}).`);
        return;
      }
      router.push(`/reporting-settings/feedback/${body.runId}`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Hint disabled={busy} content={<p>Logs who releasing {STAGE_LABELS[stage]} would message in Slack, without releasing or sending.</p>}>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void preview()}>
          {busy ? <Loader2 className="animate-spin" /> : <Eye />}
          Preview message
        </Button>
      </Hint>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
