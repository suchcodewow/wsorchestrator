"use client";

/**
 * Writing a page's tour, beside the page it is about: the steps in order,
 * dragged to reorder, each with its words, where its callout goes and the
 * element it points at, picked by clicking it on the page. Nothing is kept
 * until Save, which sends the whole tour at once; a preview plays the steps
 * as they stand. A panel, not a modal, so the page can be pointed at. Once
 * the tour is saved, "Copy tour link" copies this page's address with `?tour`
 * on it, which starts the tour for whoever opens it.
 *
 * Saving names the version the edit started from, so two administrators
 * editing at once cannot quietly overwrite each other: the second is told.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { usePathname } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, ChevronDown, Crosshair, GripVertical, Link2, Play, Plus, Trash2, TriangleAlert, X } from "lucide-react";
import { TOUR_UI, TourPicker } from "@/components/tour/tour-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TOUR_LIMITS, TOUR_PLACEMENTS, type TourPlacement } from "@/db/schema";
import { cn } from "@/lib/utils";
import { tourLink } from "@/lib/tours/link";
import { isTourPattern, suggestPattern } from "@/lib/tours/pattern";
import { resolveTarget, type TourTarget } from "@/lib/tours/target";
import type { Tour, TourStep } from "@/lib/tours/tours";

/** A step as the editor holds it: `key` identifies it while it is dragged, before it has an id of its own. */
type Draft = { key: string; title: string; body: string; placement: TourPlacement; target: TourTarget };

const PLACEMENT_LABELS: Record<TourPlacement, string> = {
  auto: "Wherever it fits",
  top: "Above",
  bottom: "Below",
  left: "To the left",
  right: "To the right",
};

/** How often the panel looks again for each step's element, which may load or vanish as the page changes. */
const RECHECK_MS = 1500;

const SELECT =
  "h-9 w-full rounded-md border border-input bg-field px-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

function draftsOf(tour: Tour | null): Draft[] {
  return (tour?.steps ?? []).map((s) => ({ key: s.id, title: s.title, body: s.body, placement: s.placement, target: s.target }));
}

function stepsOf(drafts: Draft[]): TourStep[] {
  return drafts.map(({ key, ...d }) => ({ id: key, ...d }));
}

type Picking = { key: string | null };

export function TourEditor({
  tour,
  hidden,
  onPreview,
  onSaved,
  onClose,
}: {
  tour: Tour | null;
  /** While a preview plays, the panel steps aside. */
  hidden: boolean;
  onPreview: (steps: TourStep[], start: number) => void;
  onSaved: (tour: Tour | null) => void;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const initial = useMemo(() => draftsOf(tour), [tour]);
  const [drafts, setDrafts] = useState<Draft[]>(initial);
  const [pattern, setPattern] = useState(tour?.pathPattern ?? suggestPattern(pathname));
  const [open, setOpen] = useState<string | null>(null);
  const [picking, setPicking] = useState<Picking | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"discard" | "delete" | null>(null);
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), RECHECK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const dirty = JSON.stringify(drafts) !== JSON.stringify(initial);
  const patternOk = isTourPattern(pattern);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setDrafts((d) =>
      arrayMove(
        d,
        d.findIndex((s) => s.key === active.id),
        d.findIndex((s) => s.key === over.id),
      ),
    );
  };

  const change = (key: string, patch: Partial<Draft>) => setDrafts((d) => d.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const picked = useCallback(
    (target: TourTarget) => {
      const key = picking?.key;
      setPicking(null);
      if (key) {
        setDrafts((d) => d.map((s) => (s.key === key ? { ...s, target } : s)));
        return;
      }
      const fresh: Draft = {
        key: crypto.randomUUID(),
        title: target.label.slice(0, TOUR_LIMITS.title),
        body: "",
        placement: "auto",
        target,
      };
      setDrafts((d) => [...d, fresh]);
      setOpen(fresh.key);
    },
    [picking],
  );
  const cancelPick = useCallback(() => setPicking(null), []);

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch(`/api/tours?pattern=${encodeURIComponent(pattern)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: tour?.version,
          steps: drafts.map(({ title, body, placement, target }) => ({ title, body, placement, target })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) return onSaved(body.tour as Tour);
      setProblem(
        res.status === 409
          ? `Someone saved this tour (version ${body.version}) since you opened it. Close the editor and open it again to see theirs.`
          : res.status === 403
            ? "You can't write tours for pages matching that pattern."
            : body.error === "invalid_pattern"
              ? "That isn't a path pattern."
              : "The tour couldn't be saved. Check each step has an element.",
      );
    } catch {
      setProblem("The tour couldn't be saved. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!tour) return;
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch(`/api/tours?pattern=${encodeURIComponent(tour.pathPattern)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(String(res.status));
      onSaved(null);
      onClose();
    } catch {
      setProblem("The tour couldn't be deleted. Try again.");
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(tourLink());
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  }

  const close = () => (dirty ? setConfirm("discard") : onClose());

  return (
    <>
      <aside
        {...{ [TOUR_UI]: "" }}
        aria-label="Edit this page's tour"
        className={cn(
          "fixed top-14 right-0 bottom-0 z-50 flex w-full max-w-sm flex-col border-l bg-background shadow-xl framed:top-0 dark:border-foreground/15",
          hidden && "hidden",
        )}
      >
        <div className="flex items-start gap-2 border-b px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-medium">Page tour</h2>
            {tour && (
              <p className="text-xs text-muted-foreground">
                Version {tour.version}, saved {new Date(tour.updatedAt).toLocaleString()}
              </p>
            )}
          </div>
          {tour && (
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground" onClick={copyLink}>
              {copied === "yes" ? <Check /> : <Link2 />}
              {copied === "yes" ? "Copied" : copied === "failed" ? "Couldn't copy" : "Copy tour link"}
            </Button>
          )}
          <Button variant="ghost" size="icon" className="-mr-2 size-8" aria-label="Close the editor" onClick={close}>
            <X />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Plays on</span>
            {tour ? (
              <code className="rounded-md bg-muted px-2 py-1.5 text-xs">{tour.pathPattern}</code>
            ) : (
              <>
                <Input
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value.trim())}
                  aria-invalid={!patternOk}
                  className="font-mono text-xs"
                />
                <span className={cn("text-xs", patternOk ? "text-muted-foreground" : "text-destructive")}>
                  {patternOk
                    ? "[id] stands for any one part of the path."
                    : "Start with /, and use only letters, digits, - . _ ~ and [name]."}
                </span>
              </>
            )}
          </label>

          {drafts.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              // A row closes when it is picked up (see StepRow's onGrab), so where each one is must be measured afresh.
              measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
              onDragEnd={onDragEnd}
            >
              <SortableContext items={drafts.map((d) => d.key)} strategy={verticalListSortingStrategy}>
                <ol className="divide-y rounded-xl border">
                  {drafts.map((draft, i) => (
                    <StepRow
                      key={draft.key}
                      draft={draft}
                      number={i + 1}
                      open={open === draft.key}
                      onToggle={() => setOpen((o) => (o === draft.key ? null : draft.key))}
                      onGrab={() => flushSync(() => setOpen(null))}
                      onChange={(patch) => change(draft.key, patch)}
                      onRepick={() => setPicking({ key: draft.key })}
                      onPreview={() => onPreview(stepsOf(drafts), i)}
                      onRemove={() => setDrafts((d) => d.filter((s) => s.key !== draft.key))}
                    />
                  ))}
                </ol>
              </SortableContext>
            </DndContext>
          )}

          <Button
            variant="outline"
            className="self-start"
            disabled={drafts.length >= TOUR_LIMITS.steps}
            onClick={() => setPicking({ key: null })}
          >
            <Plus /> Add a step
          </Button>
        </div>

        <div className="flex flex-col gap-3 border-t px-5 py-3">
          {problem && (
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          )}
          <div className="flex items-center gap-2">
            {tour && (
              <Button variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={() => setConfirm("delete")}>
                Delete tour
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" disabled={drafts.length === 0} onClick={() => onPreview(stepsOf(drafts), 0)}>
                <Play /> Preview
              </Button>
              <Button size="sm" disabled={busy || !dirty || drafts.length === 0 || !patternOk} onClick={() => void save()}>
                Save
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {picking && <TourPicker onPick={picked} onCancel={cancelPick} />}

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="max-w-md" {...{ [TOUR_UI]: "" }}>
          <DialogHeader>
            <DialogTitle>{confirm === "delete" ? "Delete this tour?" : "Discard your changes?"}</DialogTitle>
            <DialogDescription>
              {confirm === "delete"
                ? `Nobody will see a tour on ${tour?.pathPattern} until someone writes a new one.`
                : "The steps go back to how they were last saved."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Keep editing
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (confirm === "delete") void remove();
                else onClose();
                setConfirm(null);
              }}
            >
              {confirm === "delete" ? "Delete" : "Discard"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StepRow({
  draft,
  number,
  open,
  onToggle,
  onGrab,
  onChange,
  onRepick,
  onPreview,
  onRemove,
}: {
  draft: Draft;
  number: number;
  open: boolean;
  onToggle: () => void;
  /**
   * Called as the handle is pressed, before the drag starts. An open row is
   * closed first: dnd-kit compares rows by their centres, and an open row's is
   * too far from its neighbours' for it ever to pass one.
   */
  onGrab: () => void;
  onChange: (patch: Partial<Draft>) => void;
  onRepick: () => void;
  onPreview: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: draft.key });
  const found = typeof document !== "undefined" && resolveTarget(draft.target, document) !== null;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("bg-background first:rounded-t-xl last:rounded-b-xl", isDragging && "relative z-10 shadow-md")}
    >
      <div className="flex items-center gap-1 py-1.5 pr-2 pl-1">
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={`Move step ${number}`}
          className="cursor-grab rounded p-1.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:cursor-grabbing"
          {...attributes}
          {...listeners}
          onPointerDown={(e) => {
            onGrab();
            listeners?.onPointerDown?.(e);
          }}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") onGrab();
            listeners?.onKeyDown?.(e);
          }}
        >
          <GripVertical className="size-4" />
        </button>
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="w-5 shrink-0 text-muted-foreground tabular-nums">{number}.</span>
          <span className={cn("min-w-0 flex-1 truncate", !draft.title && "text-muted-foreground italic")}>
            {draft.title || "Untitled step"}
          </span>
          {!found && (
            <span title={`Can't find "${draft.target.label}" on this page`} className="shrink-0 text-amber-600 dark:text-amber-400">
              <TriangleAlert className="size-4" aria-label="Element not found" />
            </span>
          )}
          <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {open && (
        <div className="flex flex-col gap-3 px-3 pb-3">
          <label className="flex flex-col gap-1 text-xs font-medium">
            Title
            <Input value={draft.title} maxLength={TOUR_LIMITS.title} onChange={(e) => onChange({ title: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Text
            <Textarea value={draft.body} rows={3} maxLength={TOUR_LIMITS.body} onChange={(e) => onChange({ body: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Callout
            <select className={SELECT} value={draft.placement} onChange={(e) => onChange({ placement: e.target.value as TourPlacement })}>
              {TOUR_PLACEMENTS.map((p) => (
                <option key={p} value={p}>
                  {PLACEMENT_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <p className={cn("text-xs", found ? "text-muted-foreground" : "text-amber-700 dark:text-amber-300")}>
            {found ? "Points at" : "Can't find"} <span className="font-medium">{draft.target.label}</span>
            {found ? "" : " on this page. Pick it again, or it will be skipped."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onRepick}>
              <Crosshair /> Pick again
            </Button>
            <Button variant="outline" size="sm" disabled={!found} onClick={onPreview}>
              <Play /> From here
            </Button>
            <Button variant="ghost" size="sm" className="ml-auto text-destructive" onClick={onRemove}>
              <Trash2 /> Remove
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
