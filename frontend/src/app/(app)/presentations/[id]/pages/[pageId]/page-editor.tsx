"use client";

/**
 * The page editor: add shapes, text and a grid of hidden answers, arrange them
 * on the stage, style them, and say how each is revealed. Every change can be
 * undone; a drag or the typing in one field undoes as one step. Nothing is
 * stored until Save, and Present from here plays the page as it stands,
 * unsaved changes included.
 *
 * Keys, outside a field: Delete removes the selection, the arrows nudge it
 * (Shift for 10), ⌘D duplicates it, ⌘Z and ⇧⌘Z undo and redo, ⌘S saves, and
 * Escape lets it go.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Circle, LayoutGrid, Play, Redo2, Save, Square, Trash2, Type, Undo2 } from "lucide-react";
import { usePresenter } from "@/components/presentations/player";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import {
  PAGE_LIMITS,
  newElement,
  REVEAL_GRID_SIZES,
  revealGrid,
  type ElementKind,
  type PageDocument,
  type PageElement,
} from "@/lib/presentations/page";
import type { Presentation, PresentationPage } from "@/lib/presentations/presentations";
import { cn } from "@/lib/utils";
import { ElementPanel, PagePanel } from "./element-panel";
import { StageEditor } from "./stage-editor";

/** Changes to the same thing this close together undo as one step. */
const COALESCE_MS = 1_000;

const newId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 12);

const SELECT =
  "h-9 rounded-md border border-input bg-field px-2 text-sm text-foreground shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

const inField = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export function PageEditor({ presentation, page }: { presentation: Presentation; page: PresentationPage }) {
  const router = useRouter();
  const [doc, setDoc] = useState<PageDocument>(page.document);
  const [notes, setNotes] = useState(page.notes);
  const known = presentation.slides.some((s) => s.googlePageId === page.before);
  const [before, setBefore] = useState<string | null>(known ? page.before : null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<{ past: PageDocument[]; future: PageDocument[] }>({ past: [], future: [] });
  const last = useRef<{ key: string; at: number } | null>(null);
  const [saved, setSaved] = useState(() => JSON.stringify({ doc: page.document, notes: page.notes, before: known ? page.before : null }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify({ doc, notes, before }) !== saved;
  const selected = doc.elements.find((el) => el.id === selectedId) ?? null;
  const backHref = `/presentations/${presentation.id}`;

  const pages = useMemo(
    () => presentation.pages.map((p) => (p.id === page.id ? { ...p, document: doc, notes, before } : p)),
    [presentation.pages, page.id, doc, notes, before],
  );
  const show = useMemo(() => ({ slides: presentation.slides, pages }), [presentation.slides, pages]);
  const { present, player } = usePresenter(presentation.id, show);

  /** `next` as the page, undoable; a change with the same `key` as the one just before it joins that one's step. */
  const commit = useCallback(
    (next: PageDocument, key?: string) => {
      const now = Date.now();
      const joins = key !== undefined && last.current?.key === key && now - last.current.at < COALESCE_MS;
      last.current = key ? { key, at: now } : null;
      if (!joins) setHistory((h) => ({ past: [...h.past.slice(-99), doc], future: [] }));
      setDoc(next);
    },
    [doc],
  );

  const updateElement = useCallback(
    (id: string, patch: Partial<PageElement>, key: string) => {
      commit({ ...doc, elements: doc.elements.map((el) => (el.id === id ? { ...el, ...patch } : el)) }, key);
    },
    [commit, doc],
  );

  /** Puts `elements` on top of the page and selects the first. */
  const add = useCallback(
    (elements: PageElement[]) => {
      if (doc.elements.length + elements.length > PAGE_LIMITS.elements) {
        setError(`A page holds at most ${PAGE_LIMITS.elements} elements.`);
        return;
      }
      commit({ ...doc, elements: [...doc.elements, ...elements] });
      setSelectedId(elements[0]!.id);
    },
    [commit, doc],
  );

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    // An element that was revealed by the one removed is shown always instead of never.
    const elements = doc.elements
      .filter((el) => el.id !== selectedId)
      .map((el) => (el.reveal?.on === "click" && el.reveal.by === selectedId ? { ...el, reveal: null } : el));
    commit({ ...doc, elements });
    setSelectedId(null);
  }, [commit, doc, selectedId]);

  const duplicateSelected = useCallback(() => {
    if (selected) add([{ ...selected, id: newId(), x: selected.x + 40, y: selected.y + 40 }]);
  }, [add, selected]);

  function layer(to: "front" | "back") {
    if (!selected) return;
    const rest = doc.elements.filter((el) => el.id !== selected.id);
    commit({ ...doc, elements: to === "front" ? [...rest, selected] : [selected, ...rest] });
  }

  const undo = useCallback(() => {
    const previous = history.past[history.past.length - 1];
    if (!previous) return;
    setHistory({ past: history.past.slice(0, -1), future: [doc, ...history.future] });
    setDoc(previous);
    last.current = null;
  }, [doc, history]);

  const redo = useCallback(() => {
    const next = history.future[0];
    if (!next) return;
    setHistory({ past: [...history.past, doc], future: history.future.slice(1) });
    setDoc(next);
    last.current = null;
  }, [doc, history]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/presentations/${presentation.id}/pages/${page.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ before, document: doc, notes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.issues?.[0]?.message ? `Could not save: ${body.issues[0].message}.` : `Could not save (${res.status}).`);
        return;
      }
      setSaved(JSON.stringify({ doc, notes, before }));
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }, [before, doc, notes, page.id, presentation.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!saving) void save();
        return;
      }
      if (inField(e.target)) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelected();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        removeSelected();
      } else if (e.key === "Escape") setSelectedId(null);
      else if (selected && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const by = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -by : e.key === "ArrowRight" ? by : 0;
        const dy = e.key === "ArrowUp" ? -by : e.key === "ArrowDown" ? by : 0;
        updateElement(selected.id, { x: selected.x + dx, y: selected.y + dy }, `nudge:${selected.id}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [duplicateSelected, redo, removeSelected, save, saving, selected, undo, updateElement]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function leave() {
    if (
      dirty &&
      !(await confirmDialog({
        title: "Leave without saving?",
        description: "Your changes to this page will be lost.",
        confirmLabel: "Leave",
        destructive: true,
      }))
    )
      return;
    router.push(backHref);
  }

  async function remove() {
    const ok = await confirmDialog({
      title: "Delete this page?",
      description: "The deck in Google Slides is not touched.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/presentations/${presentation.id}/pages/${page.id}`, { method: "DELETE" });
    if (res.ok) router.push(backHref);
    else setError(`Could not delete it (${res.status}).`);
  }

  const addKind = (kind: ElementKind) => add([newElement(kind, newId())]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={backHref}
            onClick={(e) => {
              if (!dirty) return;
              e.preventDefault();
              void leave();
            }}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            {presentation.name}
          </Link>
          <h1 className="text-xl font-medium tracking-tight">Page</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Where the page goes"
            className={SELECT}
            value={before ?? ""}
            onChange={(e) => setBefore(e.target.value || null)}
          >
            {presentation.slides.map((s) => (
              <option key={s.googlePageId} value={s.googlePageId}>
                Before slide {s.number}
                {s.skipped ? " (skipped)" : ""}
              </option>
            ))}
            <option value="">At the end</option>
          </select>
          <Button variant="outline" onClick={() => present(page.id)}>
            <Play />
            Present from here
          </Button>
          <Button variant="ghost" size="icon" aria-label="Delete page" onClick={() => void remove()}>
            <Trash2 />
          </Button>
          <Button variant="brand" disabled={!dirty || saving} onClick={() => void save()}>
            <Save />
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => addKind("text")}>
              <Type />
              Text
            </Button>
            <Button variant="outline" size="sm" onClick={() => addKind("rect")}>
              <Square />
              Rectangle
            </Button>
            <Button variant="outline" size="sm" onClick={() => addKind("ellipse")}>
              <Circle />
              Ellipse
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <LayoutGrid />
                  Reveal grid
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {REVEAL_GRID_SIZES.map((count) => (
                  <DropdownMenuItem key={count} onSelect={() => add(revealGrid(count, newId))}>
                    {count} cards, each hiding an answer
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <span className="mx-1 h-5 w-px bg-border" />
            <Button variant="ghost" size="icon" aria-label="Undo" disabled={history.past.length === 0} onClick={undo}>
              <Undo2 />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Redo" disabled={history.future.length === 0} onClick={redo}>
              <Redo2 />
            </Button>
          </div>

          <StageEditor
            document={doc}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={(id, box, gesture) => updateElement(id, box, gesture)}
          />

          <div className="space-y-1.5">
            <label htmlFor="page-notes" className="text-sm font-medium">
              Speaker notes
            </label>
            <Textarea id="page-notes" value={notes} rows={4} maxLength={PAGE_LIMITS.notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <div className={cn("space-y-3", "lg:sticky lg:top-4 lg:self-start")}>
          {selected ? (
            <ElementPanel
              document={doc}
              element={selected}
              onChange={(patch, key) => updateElement(selected.id, patch, key)}
              onLayer={layer}
              onDuplicate={duplicateSelected}
              onDelete={removeSelected}
            />
          ) : (
            <PagePanel document={doc} onBackground={(background) => commit({ ...doc, background }, "background")} />
          )}
        </div>
      </div>
      {player}
    </div>
  );
}
