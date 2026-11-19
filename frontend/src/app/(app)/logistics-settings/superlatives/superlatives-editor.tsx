"use client";

/**
 * Edits the standing list of superlatives every Bootcamp's superlatives
 * survey asks: one line each, in order. Saving replaces the whole list. A
 * survey already sent keeps the list it was sent with, so a change reaches
 * only the Bootcamps sent theirs afterwards.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowDown, ArrowUp, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SUPERLATIVE_LIMITS, type Superlative } from "@/db/schema";
import { riseChild, staggerParent } from "@/lib/motion";

const ERRORS: Record<string, string> = {
  invalid: "Give every superlative some wording, or remove it.",
  forbidden: "Your own role changed — reload the page.",
};

const newId = () => `s-${crypto.randomUUID().slice(0, 8)}`;

export function SuperlativesEditor({ list }: { list: { superlatives: Superlative[]; updatedAt: string | null } }) {
  const router = useRouter();
  const [superlatives, setSuperlatives] = useState<Superlative[]>(list.superlatives);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(list.updatedAt);

  const canSave = superlatives.every((x) => x.title.trim().length > 0);
  const full = superlatives.length >= SUPERLATIVE_LIMITS.superlatives;

  function change(id: string, title: string) {
    setSuperlatives((all) => all.map((x) => (x.id === id ? { ...x, title } : x)));
  }

  function move(index: number, by: -1 | 1) {
    setSuperlatives((all) => {
      const next = [...all];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item!);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/logistics/superlatives", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ superlatives }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(ERRORS[body?.error ?? ""] ?? `Could not save (${res.status}).`);
        return;
      }
      setSuperlatives(body.superlatives);
      setSavedAt(body.updatedAt);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="max-w-3xl space-y-6">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">Bootcamp superlatives</h2>
        <p className="text-sm text-muted-foreground">
          {superlatives.length} {superlatives.length === 1 ? "superlative" : "superlatives"}
          {savedAt ? (
            <>
              , last saved <span className="font-medium text-foreground">{new Date(savedAt).toLocaleString()}</span>
            </>
          ) : (
            ", not saved yet"
          )}
        </p>
      </motion.div>

      <motion.div variants={staggerParent(0.04)} className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
        <motion.p variants={riseChild} className="px-5 py-4 text-sm text-muted-foreground">
          Every Bootcamp&apos;s schedule has a Send Superlatives button. It sends this list to the whole class, Sales and Engineers
          together, and each person votes one classmate, not themselves, for each superlative. A Bootcamp keeps the list it was sent,
          so changes here reach only the Bootcamps sent theirs afterwards. The votes are on Survey Results.
        </motion.p>
        {superlatives.length === 0 && (
          <motion.p variants={riseChild} className="px-5 py-8 text-center text-sm text-muted-foreground">
            No superlatives yet. Add one, such as &ldquo;Most likely to close a deal on the first call&rdquo;.
          </motion.p>
        )}

        {superlatives.map((x, i) => (
          <motion.div key={x.id} variants={riseChild} className="flex items-center gap-2 px-5 py-3">
            <span className="w-6 shrink-0 text-sm text-muted-foreground">{i + 1}.</span>
            <Input
              aria-label={`Superlative ${i + 1}`}
              placeholder="Most likely to…"
              value={x.title}
              maxLength={SUPERLATIVE_LIMITS.title}
              onChange={(e) => change(x.id, e.target.value)}
              className="flex-1"
            />
            <div className="flex shrink-0 gap-1">
              <Button variant="ghost" size="icon" aria-label={`Move superlative ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Move superlative ${i + 1} down`}
                disabled={i === superlatives.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove superlative ${i + 1}`}
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setSuperlatives((all) => all.filter((y) => y.id !== x.id))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </motion.div>
        ))}

        <motion.div variants={riseChild} className="flex flex-wrap items-center gap-3 px-5 py-4">
          <Button variant="outline" disabled={full} onClick={() => setSuperlatives((all) => [...all, { id: newId(), title: "" }])}>
            <Plus />
            Add superlative
          </Button>
          {full && (
            <span className="text-sm text-muted-foreground">A survey asks at most {SUPERLATIVE_LIMITS.superlatives}.</span>
          )}
        </motion.div>
      </motion.div>

      {error && (
        <motion.p variants={riseChild} role="alert" className="text-sm text-destructive">
          {error}
        </motion.p>
      )}

      <motion.div variants={riseChild}>
        <Button variant="brand" disabled={!canSave || busy} onClick={save}>
          {busy ? <Loader2 className="animate-spin" /> : <Save />}
          Save
        </Button>
      </motion.div>
    </motion.div>
  );
}
