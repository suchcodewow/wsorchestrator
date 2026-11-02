"use client";

/**
 * The Map Editor's page: the live map's sections, groups and concepts as a
 * form, a bar that says what has changed and saves it as the next version,
 * and the history of versions, any of which can be put back. A save names the
 * version it was made from, so one made over somebody else's is refused with
 * the version that is live now.
 */

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { ChevronRight, History, Loader2, RotateCcw, Save, Undo2 } from "lucide-react";
import { HEADER_ROW, Pager, PlainHeader, SortHeader } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { MimirMapSource } from "@/db/schema";
import type { MapVersionSort } from "@/lib/list-specs";
import type { MapVersionRow } from "@/lib/mimir/map/content";
import { describeChanges } from "@/lib/mimir/map/edit";
import { MAP_SUMMARY_MAX, POINTS_MAX, conceptsInOrder, mapContentSchema, type MapContent, type MapLevel } from "@/lib/mimir/map/schema";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { cn } from "@/lib/utils";
import { formatWhen } from "../../cohort-settings/format";

const SELECT = cn(
  "h-9 w-full rounded-md border border-input bg-field px-2 text-sm text-foreground shadow-xs outline-none",
  "focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
);
const CARD = "overflow-hidden rounded-2xl border bg-card shadow-sm";
const LEVELS: MapLevel[] = [1, 2, 3];
const BANDS = [1, 2, 3, 4];
/** How many of the changes the save bar lists before it counts the rest. */
const SHOWN_CHANGES = 6;

const SOURCE_LABELS: Record<MimirMapSource, string> = {
  import: "Imported",
  deck: "From a deck",
  edit: "Edited",
  restore: "Restored",
  migration: "Before versions",
};

type Live = { version: number; savedAt: string; content: MapContent } | null;

export function MapEditorView({ live, query, versions }: { live: Live; query: ListQuery<MapVersionSort>; versions: Page<MapVersionRow> }) {
  return (
    <motion.div variants={staggerParent(0.04)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild}>
        <h2 className="text-xl font-medium tracking-tight">Map Editor</h2>
        {live && (
          <p className="text-sm text-muted-foreground">
            Version {live.version}, saved {formatWhen(live.savedAt)}
          </p>
        )}
      </motion.div>
      {live ? (
        <Editor key={live.version} live={live} />
      ) : (
        <motion.p variants={riseChild} className={cn(CARD, "px-5 py-4 text-sm text-muted-foreground")}>
          There is no map to edit yet. Import one on the Map tab.
        </motion.p>
      )}
      <motion.div variants={riseChild}>
        <VersionHistory live={live?.version ?? null} query={query} versions={versions} />
      </motion.div>
    </motion.div>
  );
}

type SaveError = { kind: "conflict"; live: number } | { kind: "invalid"; message: string } | { kind: "other"; message: string };

/** The form over one live version; remounted when another version goes live. */
function Editor({ live }: { live: NonNullable<Live> }) {
  const router = useRouter();
  const [draft, setDraft] = useState<MapContent>(live.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<SaveError | null>(null);
  const cleaned = useMemo(() => clean(draft), [draft]);
  const changes = useMemo(() => describeChanges(live.content, cleaned), [live.content, cleaned]);
  const problem = useMemo(() => {
    const parsed = mapContentSchema.safeParse(cleaned);
    const issue = parsed.success ? null : parsed.error.issues[0];
    return parsed.success ? null : issue ? `${where(cleaned, issue.path)}${issue.message}` : "The map does not fit its shape.";
  }, [cleaned]);
  const dirty = changes.length > 0;

  // A browser tab closed with changes unsaved loses them; say so first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/mimir/map/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base: live.version, content: cleaned, summary: changes.join(" ").slice(0, MAP_SUMMARY_MAX) }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; live?: number; message?: string; path?: string };
      if (res.status === 409) setError({ kind: "conflict", live: body.live ?? live.version });
      else if (body.error === "invalid") setError({ kind: "invalid", message: `${body.message ?? "Invalid"}${body.path ? ` (at ${body.path})` : ""}` });
      else if (!res.ok) setError({ kind: "other", message: `Couldn't save it (${res.status}).` });
      else router.refresh();
    } catch {
      setError({ kind: "other", message: "Couldn't reach the server." });
    } finally {
      setSaving(false);
    }
  }

  const update = (change: (m: MapContent) => MapContent) => {
    setError(null);
    setDraft((m) => change(m));
  };

  return (
    <>
      <motion.div variants={riseChild}>
        <Sections draft={draft} update={update} />
      </motion.div>
      <motion.div variants={riseChild}>
        <Groups draft={draft} update={update} />
      </motion.div>
      <motion.div variants={riseChild}>
        <Concepts draft={draft} update={update} />
      </motion.div>

      {(dirty || error) && (
        <div className="sticky bottom-4 z-10 rounded-2xl border bg-card p-4 shadow-lg">
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1 space-y-1 text-sm">
              <p className="font-medium">
                {changes.length} {changes.length === 1 ? "change" : "changes"} to save as version {live.version + 1}
              </p>
              <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                {changes.slice(0, SHOWN_CHANGES).map((line) => (
                  <li key={line} className="wrap-break-word">
                    {line}
                  </li>
                ))}
                {changes.length > SHOWN_CHANGES && <li>and {changes.length - SHOWN_CHANGES} more.</li>}
              </ul>
              {problem && (
                <p role="alert" className="text-destructive">
                  Can&apos;t save yet: {problem}
                </p>
              )}
              {error?.kind === "conflict" && (
                <p role="alert" className="text-destructive">
                  Version {error.live} was saved after you opened this one, so this would overwrite it. Discard your changes to load it, then make them again.
                </p>
              )}
              {error && error.kind !== "conflict" && (
                <p role="alert" className="text-destructive">
                  {error.message}
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => {
                  setDraft(live.content);
                  setError(null);
                  if (error?.kind === "conflict") router.refresh();
                }}
              >
                <Undo2 />
                Discard
              </Button>
              <Button disabled={saving || !dirty || Boolean(problem) || error?.kind === "conflict"} onClick={() => void save()}>
                {saving ? <Loader2 className="animate-spin" /> : <Save />}
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

type Update = (change: (m: MapContent) => MapContent) => void;

/** The draft as it would be saved: blank lines in a concept's main points dropped, and none at all for no points. */
function clean(m: MapContent): MapContent {
  return {
    ...m,
    concepts: m.concepts.map((c) => {
      if (!c.points) return c;
      const points = c.points.map((p) => p.trim()).filter(Boolean);
      const kept: MapContent["concepts"][number] = { ...c, points };
      if (points.length === 0) delete kept.points;
      return kept;
    }),
  };
}

/** Which part of the map a validation problem is in, by its name, to lead the message. */
function where(m: MapContent, path: PropertyKey[]): string {
  const [list, index] = path;
  if (typeof index !== "number") return "";
  if (list === "concepts") return `“${m.concepts[index]?.name ?? "A concept"}”: `;
  if (list === "sections") return `Section “${m.sections[index]?.name ?? index + 1}”: `;
  if (list === "buckets") return `Group “${m.buckets[index]?.name ?? index + 1}”: `;
  return "";
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block space-y-1 text-xs text-muted-foreground", className)}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function Sections({ draft, update }: { draft: MapContent; update: Update }) {
  const set = (i: number, patch: Partial<MapContent["sections"][number]>) =>
    update((m) => ({ ...m, sections: m.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const number = (raw: string) => Math.max(1, Math.floor(Number(raw) || 1));
  return (
    <section className={CARD} aria-labelledby="map-sections">
      <h3 id="map-sections" className="border-b px-5 py-3 text-sm font-medium">
        Sections
      </h3>
      <div className="divide-y">
        {draft.sections.length === 0 && <p className="px-5 py-4 text-sm text-muted-foreground">This map has no sections.</p>}
        {draft.sections.map((s, i) => (
          <div key={i} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_6rem_6rem_6rem]">
            <Field label="Name">
              <Input value={s.name} maxLength={80} onChange={(e) => set(i, { name: e.target.value })} />
            </Field>
            <Field label="From slide">
              <Input type="number" min={1} value={s.from} onChange={(e) => set(i, { from: number(e.target.value) })} />
            </Field>
            <Field label="To slide">
              <Input type="number" min={1} value={s.to} onChange={(e) => set(i, { to: number(e.target.value) })} />
            </Field>
            <Field label="Band">
              <select className={SELECT} value={s.band} onChange={(e) => set(i, { band: Number(e.target.value) })}>
                {BANDS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ))}
      </div>
    </section>
  );
}

const groupLabel = (g: MapContent["buckets"][number]) => (g.sub ? `${g.name} — ${g.sub}` : g.name);

function Groups({ draft, update }: { draft: MapContent; update: Update }) {
  const names = new Map(draft.concepts.map((c) => [c.id, c.name]));
  const set = (i: number, patch: Partial<MapContent["buckets"][number]>) =>
    update((m) => ({ ...m, buckets: m.buckets.map((g, j) => (j === i ? { ...g, ...patch } : g)) }));
  return (
    <section className={CARD} aria-labelledby="map-groups">
      <h3 id="map-groups" className="border-b px-5 py-3 text-sm font-medium">
        Groups
      </h3>
      <div className="divide-y">
        {draft.buckets.map((g, i) => (
          <div key={`${g.id}|${g.sub ?? ""}`} className="space-y-3 px-5 py-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_12rem_6rem]">
              <Field label="Name">
                <Input value={g.name} maxLength={120} onChange={(e) => set(i, { name: e.target.value })} />
              </Field>
              <Field label="Part (when split in two)">
                <Input value={g.sub ?? ""} maxLength={80} onChange={(e) => set(i, { sub: e.target.value || undefined })} />
              </Field>
              <Field label="Level">
                <select className={SELECT} value={g.level} onChange={(e) => set(i, { level: Number(e.target.value) as MapLevel })}>
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Description">
              <Textarea rows={2} value={g.blurb} maxLength={400} onChange={(e) => set(i, { blurb: e.target.value })} />
            </Field>
            <p className="text-xs text-muted-foreground">
              {g.concepts.length === 1 ? "1 concept" : `${g.concepts.length} concepts`}: {g.concepts.map((id) => names.get(id) ?? id).join(", ")}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Concepts({ draft, update }: { draft: MapContent; update: Update }) {
  const [open, setOpen] = useState<string | null>(null);
  const ordered = conceptsInOrder(draft);
  return (
    <section className={CARD} aria-labelledby="map-concepts">
      <h3 id="map-concepts" className="border-b px-5 py-3 text-sm font-medium">
        Concepts and what they depend on
      </h3>
      <div className="divide-y">
        {ordered.map((c) => {
          const expanded = open === c.id;
          return (
            <div key={c.id}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : c.id)}
                className="flex w-full cursor-pointer items-center gap-3 px-5 py-3 text-left text-sm transition-colors hover:bg-muted/30"
              >
                <ChevronRight className={cn("size-4 shrink-0 transition-transform", expanded && "rotate-90")} />
                <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  Level {c.level}
                  {c.requires?.length ? ` · depends on ${c.requires.length}` : ""}
                </span>
              </button>
              {expanded && <ConceptForm id={c.id} draft={draft} update={update} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ConceptForm({ id, draft, update }: { id: string; draft: MapContent; update: Update }) {
  const ordered = conceptsInOrder(draft);
  const concept = ordered.find((c) => c.id === id)!;
  const groupIndex = draft.buckets.findIndex((g) => g.concepts.includes(id));
  const lower = ordered.filter((c) => c.level < concept.level);
  const set = (patch: Partial<MapContent["concepts"][number]>) =>
    update((m) => ({ ...m, concepts: m.concepts.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const moveTo = (to: number) =>
    update((m) => ({
      ...m,
      buckets: m.buckets.map((g, j) => ({ ...g, concepts: j === to ? [...g.concepts.filter((x) => x !== id), id] : g.concepts.filter((x) => x !== id) })),
    }));
  const toggle = (rid: string, on: boolean) => {
    const now = concept.requires ?? [];
    const next = on ? [...now, rid] : now.filter((x) => x !== rid);
    set({ requires: next.length ? next : undefined });
  };

  return (
    <div className="space-y-3 border-t bg-muted/20 px-5 py-4 pl-12">
      <div className="grid gap-3 sm:grid-cols-[1fr_16rem]">
        <Field label="Name">
          <Input value={concept.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Group">
          <select className={SELECT} value={groupIndex} onChange={(e) => moveTo(Number(e.target.value))}>
            {draft.buckets.map((g, j) => (
              <option key={`${g.id}|${g.sub ?? ""}`} value={j}>
                {groupLabel(g)} (level {g.level})
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Explanation">
        <Textarea rows={4} value={concept.explanation} maxLength={4000} onChange={(e) => set({ explanation: e.target.value })} />
      </Field>
      <Field label={`Main points, one a line (up to ${POINTS_MAX}; leave empty for the coach to write them)`}>
        <Textarea
          rows={3}
          value={(concept.points ?? []).join("\n")}
          onChange={(e) => {
            const points = e.target.value.split("\n");
            set({ points: points.some((p) => p.trim()) ? points : undefined });
          }}
        />
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-xs text-muted-foreground">Depends on (concepts at a lower level)</legend>
        {lower.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing comes before level {concept.level}.</p>
        ) : (
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {lower.map((r) => (
              <label key={r.id} className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={concept.requires?.includes(r.id) ?? false} onChange={(e) => toggle(r.id, e.target.checked)} />
                <span className="truncate">{r.name}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
    </div>
  );
}

function VersionHistory({ live, query, versions }: { live: number | null; query: ListQuery<MapVersionSort>; versions: Page<MapVersionRow> }) {
  const router = useRouter();
  // The row stays when the dialog closes, so its words do not change while it fades out.
  const [restoring, setRestoring] = useState<MapVersionRow | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sortProps = { sort: query.sort, dir: query.dir };

  async function restore(row: MapVersionRow) {
    if (live === null) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/mimir/map/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base: live, restore: row.version }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; live?: number };
      if (res.status === 409) throw new Error(`Version ${body.live} was saved meanwhile. Reload the page and try again.`);
      if (!res.ok) throw new Error(`Couldn't restore it (${res.status}).`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't restore it.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={CARD} aria-labelledby="map-history">
      <h3 id="map-history" className="flex items-center gap-2 border-b px-5 py-3 text-sm font-medium">
        <History className="size-4 text-muted-foreground" />
        History
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-160 text-sm">
          <thead>
            <tr className={HEADER_ROW}>
              <SortHeader column="version" {...sortProps}>
                Version
              </SortHeader>
              <SortHeader column="createdAt" {...sortProps}>
                Saved
              </SortHeader>
              <PlainHeader>By</PlainHeader>
              <PlainHeader>What changed</PlainHeader>
              <PlainHeader />
            </tr>
          </thead>
          <tbody>
            {versions.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-muted-foreground">
                  No versions yet.
                </td>
              </tr>
            )}
            {versions.rows.map((v) => (
              <tr key={v.version} className="border-b align-top last:border-b-0">
                <td className="px-5 py-3 tnum">
                  {v.version}
                  {v.live && <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">Live</span>}
                </td>
                <td className="px-5 py-3 whitespace-nowrap text-muted-foreground">{formatWhen(v.createdAt)}</td>
                <td className="px-5 py-3 whitespace-nowrap text-muted-foreground">{v.createdBy ? v.createdBy.name || v.createdBy.email : "—"}</td>
                <td className="max-w-xl px-5 py-3">
                  <span className="mr-2 text-xs text-muted-foreground">{SOURCE_LABELS[v.source]}</span>
                  <span className="wrap-break-word">{v.summary}</span>
                </td>
                <td className="px-5 py-3 text-right">
                  {!v.live && live !== null && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setError(null);
                        setRestoring(v);
                        setOpen(true);
                      }}
                    >
                      <RotateCcw />
                      Restore
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t empty:hidden">
        <Pager page={versions} noun="versions" />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore version {restoring?.version}?</DialogTitle>
            <DialogDescription>
              Its sections, groups and concepts become the live map as version {(live ?? 0) + 1}. Every concept keeps the video it has now, and the versions after it
              stay in the history.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={() => restoring && void restore(restoring)} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
