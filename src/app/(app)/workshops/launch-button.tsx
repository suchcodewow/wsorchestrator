"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LaunchButton({ workshopId }: { workshopId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function launch() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workshopId }),
      });
      if (!res.ok) throw new Error(`Launch failed (${res.status})`);
      const { run } = await res.json();
      router.push(`/runs/${run.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Launch failed");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button onClick={launch} disabled={pending} size="sm">
        {pending ? (
          <Loader2 className="animate-spin" />
        ) : (
          <Rocket />
        )}
        {pending ? "Launching…" : "Launch"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
