"use client";

/**
 * The two pieces of content every coaching conversation is given besides the
 * item itself. A save reaches conversations that start after it.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MIMIR_SETTING_MAX } from "@/db/schema";
import { riseChild, staggerParent } from "@/lib/motion";
import { formatWhen } from "../../cohort-settings/format";

type Settings = { platformContext: string; namingGuard: string; updatedAt: string | null; updatedBy: string | null };

export function CoachingForm({ settings }: { settings: Settings }) {
  const router = useRouter();
  const [platformContext, setPlatformContext] = useState(settings.platformContext);
  const [namingGuard, setNamingGuard] = useState(settings.namingGuard);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = platformContext !== settings.platformContext || namingGuard !== settings.namingGuard;

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/mimir/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platformContext, namingGuard }),
      });
      if (!res.ok) {
        setMessage({ ok: false, text: `Could not save (${res.status}).` });
        return;
      }
      setMessage({ ok: true, text: "Saved. Conversations that start from now on use it." });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div variants={staggerParent(0.04)} initial="hidden" animate="show" className="max-w-3xl space-y-6">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">Coaching</h2>
        <p className="text-sm text-muted-foreground">
          {settings.updatedAt ? (
            <>
              Saved {formatWhen(settings.updatedAt)}
              {settings.updatedBy && <> by {settings.updatedBy}</>}
            </>
          ) : (
            "The defaults, never saved"
          )}
        </p>
      </motion.div>

      <motion.div variants={riseChild} className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
        <section className="space-y-2 px-5 py-4">
          <label htmlFor="mimir-platform" className="text-sm font-medium">
            Platform context
          </label>
          <p className="text-xs text-muted-foreground">Given to the coach on agents, capabilities, competitors and use cases.</p>
          <Textarea
            id="mimir-platform"
            value={platformContext}
            maxLength={MIMIR_SETTING_MAX}
            onChange={(e) => setPlatformContext(e.target.value)}
            className="min-h-56 font-mono text-xs"
          />
        </section>
        <section className="space-y-2 px-5 py-4">
          <label htmlFor="mimir-naming" className="text-sm font-medium">
            Naming
          </label>
          <p className="text-xs text-muted-foreground">Added to the end of every prompt, so the coach uses Harness&apos;s names: agents and capabilities, never modules.</p>
          <Textarea
            id="mimir-naming"
            value={namingGuard}
            maxLength={MIMIR_SETTING_MAX}
            onChange={(e) => setNamingGuard(e.target.value)}
            className="min-h-28 font-mono text-xs"
          />
        </section>
      </motion.div>

      <motion.div variants={riseChild} className="flex flex-wrap items-center gap-3">
        <Button variant="brand" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? <Loader2 className="animate-spin" /> : <Save />}
          Save
        </Button>
        {message && (
          <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
            {message.text}
          </p>
        )}
      </motion.div>
    </motion.div>
  );
}
