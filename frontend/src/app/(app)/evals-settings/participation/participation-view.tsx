"use client";

/**
 * The descriptors judges mark, positive and constructive, and the net marks
 * each participation score starts at. A descriptor taken off the list is
 * retired: the marks made on it stay, and count for nothing from then on.
 * Saved scores do not change when the bands do.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowDown, ArrowUp, Loader2, Plus, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PARTICIPATION_LIMITS, type ParticipationPolarity } from "@/db/schema";
import type { ParticipationSettings } from "@/lib/evals/participation";
import { bandsInOrder, type ParticipationBands } from "@/lib/evals/participation-values";
import { riseChild, staggerParent } from "@/lib/motion";

type Row = { key: string; id?: string; name: string; polarity: ParticipationPolarity };

const SECTIONS: { polarity: ParticipationPolarity; label: string }[] = [
  { polarity: "positive", label: "Positive descriptors" },
  { polarity: "negative", label: "Constructive descriptors" },
];

const BANDS: { band: keyof ParticipationBands; label: string }[] = [
  { band: "four", label: "A 4 starts at" },
  { band: "three", label: "A 3 starts at" },
  { band: "two", label: "A 2 starts at" },
];

const ERRORS: Record<string, string> = {
  duplicate: "Two descriptors have the same name.",
  invalid: "Name every descriptor, and keep the 4 above the 3 and the 3 above the 2.",
  not_found: "A descriptor has been removed since this page loaded. Reload to see the list.",
  forbidden: "You can no longer change these — reload the page.",
};

export function ParticipationView({ settings }: { settings: ParticipationSettings }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => settings.descriptors.map((d) => ({ ...d, key: d.id })));
  const [bands, setBands] = useState<Record<keyof ParticipationBands, string>>({
    four: String(settings.bands.four),
    three: String(settings.bands.three),
    two: String(settings.bands.two),
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const parsed = { four: Number(bands.four), three: Number(bands.three), two: Number(bands.two) };
  const bandsValid = Object.values(parsed).every(Number.isInteger) && bandsInOrder(parsed);
  const canSave = bandsValid && rows.every((r) => r.name.trim()) && rows.length <= PARTICIPATION_LIMITS.descriptors;

  function change(next: Row[]) {
    setRows(next);
    setSaved(false);
  }

  function move(row: Row, by: -1 | 1) {
    const peers = rows.filter((r) => r.polarity === row.polarity);
    const other = peers[peers.indexOf(row) + by];
    if (!other) return;
    change(rows.map((r) => (r === row ? other : r === other ? row : r)));
  }

  async function save() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/evals/participation/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descriptors: rows.map(({ id, name, polarity }) => ({ id, name, polarity })),
          bands: parsed,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(ERRORS[body?.error ?? ""] ?? `Could not save (${res.status}).`);
        return;
      }
      const next = body as ParticipationSettings;
      setRows(next.descriptors.map((d) => ({ ...d, key: d.id })));
      setSaved(true);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPending(false);
    }
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="max-w-3xl space-y-6">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">Participation</h2>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{rows.length.toLocaleString()}</span>{" "}
          {rows.length === 1 ? "descriptor" : "descriptors"}, each counted from 0 to {PARTICIPATION_LIMITS.maxCount}
        </p>
      </motion.div>

      <motion.div variants={riseChild} className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
        {SECTIONS.map(({ polarity, label }) => {
          const peers = rows.filter((r) => r.polarity === polarity);
          return (
            <section key={polarity} className="space-y-3 px-5 py-4">
              <h3 className="font-medium">{label}</h3>
              <ul className="space-y-2">
                {peers.map((row, i) => (
                  <li key={row.key} className="flex items-center gap-1">
                    <Input
                      aria-label={`${label}: name`}
                      value={row.name}
                      maxLength={PARTICIPATION_LIMITS.name}
                      onChange={(e) => change(rows.map((r) => (r === row ? { ...r, name: e.target.value } : r)))}
                    />
                    <Button variant="ghost" size="icon" aria-label={`Move ${row.name} up`} disabled={i === 0} onClick={() => move(row, -1)}>
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Move ${row.name} down`}
                      disabled={i === peers.length - 1}
                      onClick={() => move(row, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${row.name}`}
                      onClick={() => change(rows.filter((r) => r !== row))}
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
              <Button
                variant="outline"
                size="sm"
                disabled={rows.length >= PARTICIPATION_LIMITS.descriptors}
                onClick={() => change([...rows, { key: crypto.randomUUID(), name: "", polarity }])}
              >
                <Plus />
                Add descriptor
              </Button>
            </section>
          );
        })}

        <section className="space-y-3 px-5 py-4">
          <h3 className="font-medium">Net marks for each score</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            {BANDS.map(({ band, label }) => (
              <label key={band} className="space-y-1.5 text-sm">
                <span className="text-muted-foreground">{label}</span>
                <Input
                  type="number"
                  step={1}
                  value={bands[band]}
                  aria-invalid={!bandsValid}
                  onChange={(e) => {
                    setBands((all) => ({ ...all, [band]: e.target.value }));
                    setSaved(false);
                  }}
                />
              </label>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">Below {parsed.two} scores a 1. No marks at all scores a 2.</p>
        </section>
      </motion.div>

      {error && (
        <motion.p variants={riseChild} role="alert" className="text-sm text-destructive">
          {error}
        </motion.p>
      )}

      <motion.div variants={riseChild} className="flex items-center gap-3">
        <Button variant="brand" disabled={!canSave || pending} onClick={save}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />}
          Save
        </Button>
        {saved && (
          <span role="status" className="text-sm text-muted-foreground">
            Saved
          </span>
        )}
      </motion.div>
    </motion.div>
  );
}
