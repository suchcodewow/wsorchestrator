"use client";

/** Composes a workshop out of lab guides. */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  PenLine,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LAB_WORKSHOP_LIMITS, type LabWorkshop } from "@/db/schema";
import { cn } from "@/lib/utils";
import { GuidePreviewDialog } from "./guide-preview-dialog";

export type PickerGuide = {
  id: string;
  slug: string;
  title: string;
  summary: string;
};

export function WorkshopEditor({
  workshop,
  initialGuideIds = [],
  guides,
}: {
  workshop?: LabWorkshop;
  initialGuideIds?: string[];
  guides: PickerGuide[];
}) {
  const router = useRouter();
  const editing = workshop !== undefined;

  const [title, setTitle] = useState(workshop?.title ?? "");
  const [summary, setSummary] = useState(workshop?.summary ?? "");
  const [published, setPublished] = useState(workshop?.published ?? false);
  const [contents, setContents] = useState<string[]>(initialGuideIds);

  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(
    () => new Map(guides.map((g) => [g.id, g])),
    [guides],
  );

  const chosen = contents
    .map((id) => byId.get(id))
    .filter((g): g is PickerGuide => g !== undefined);

  const available = guides.filter((g) => !contents.includes(g.id));
  const matches = query.trim()
    ? available.filter((g) =>
        `${g.title} ${g.summary}`.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : available;

  const full = contents.length >= LAB_WORKSHOP_LIMITS.guides;

  function add(id: string) {
    if (full) return;
    setContents((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setQuery("");
  }

  function remove(id: string) {
    setContents((prev) => prev.filter((g) => g !== id));
  }

  function move(index: number, delta: -1 | 1) {
    const to = index + delta;
    if (to < 0 || to >= contents.length) return;

    setContents((prev) => {
      const next = [...prev];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  }

  async function persist(): Promise<{ id: string; slug: string } | null> {
    if (title.trim().length === 0) {
      setError("Give the workshop a title.");
      return null;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        editing ? `/api/lab-workshops/${workshop.id}` : "/api/lab-workshops",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            summary,
            published,
            guideIds: contents,
          }),
        },
      );
      if (!res.ok) {
        throw new Error(
          res.status === 400
            ? "One of these guides no longer exists — reload and try again."
            : `Could not save the workshop (${res.status})`,
        );
      }

      const { workshop: saved } = await res.json();
      return saved;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save the workshop",
      );
      setSaving(false);
      return null;
    }
  }

  async function save() {
    const saved = await persist();
    if (!saved) return;

    router.push(`/labs/${saved.slug}`);
    router.refresh();
  }

  async function saveThenWriteGuide() {
    const saved = await persist();
    if (!saved) return;

    router.push(`/labs/guides/new?workshop=${saved.id}`);
    router.refresh();
  }

  async function removeWorkshop() {
    if (!editing) return;
    if (
      !window.confirm(
        `Delete "${workshop.title}", keeping the guides in it?`,
      )
    ) {
      return;
    }

    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/lab-workshops/${workshop.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Could not delete the workshop (${res.status})`);
      router.push("/labs");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not delete the workshop",
      );
      setDeleting(false);
    }
  }

  const busy = saving || deleting;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="grid gap-6"
    >
      <div className="grid gap-1.5">
        <label htmlFor="workshop-title" className="text-sm font-medium">
          Title
        </label>
        <Input
          id="workshop-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={LAB_WORKSHOP_LIMITS.title}
          placeholder="e.g. Platform engineering onboarding"
          required
          autoFocus={!editing}
        />
        {editing && workshop.published && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            The address stays{" "}
            <code className="text-foreground">/labs/{workshop.slug}</code> — it
            was published under that URL, and moving it now would break every
            link already handed out.
          </p>
        )}
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="workshop-summary" className="text-sm font-medium">
          Summary
        </label>
        <Input
          id="workshop-summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          maxLength={LAB_WORKSHOP_LIMITS.summary}
          placeholder="One line, shown on the list of workshops."
        />
      </div>

      <section className="overflow-hidden rounded-xl border bg-card/40 dark:bg-card/50">
        <div className="flex flex-col items-start gap-3 border-b bg-muted/30 px-4 py-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div>
            <h2 className="text-sm font-medium">Contents</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              The order the room works through, using guides that can sit in
              any number of workshops.
            </p>
          </div>

          <Button
            type="button"
            variant={picking ? "secondary" : "outline"}
            size="sm"
            disabled={full}
            onClick={() => setPicking((p) => !p)}
          >
            {picking ? <X /> : <Plus />}
            {picking ? "Done" : "Add a guide"}
          </Button>
        </div>

        <div className="grid gap-2 p-4">
          {chosen.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <p className="text-sm font-medium">No guides yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add a guide to give the room something to read.
              </p>
            </div>
          ) : (
            <ol className="grid min-w-0 grid-cols-1 gap-2">
              {chosen.map((guide, i) => (
                <li
                  key={guide.id}
                  className="flex items-center gap-3 rounded-lg border bg-card/60 dark:bg-card p-3"
                >
                  <span className="tnum w-5 shrink-0 text-center text-sm text-muted-foreground">
                    {i + 1}
                  </span>

                  <span className="block min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {guide.title}
                    </span>
                    {guide.summary && (
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {guide.summary}
                      </span>
                    )}
                  </span>

                  <span className="flex shrink-0 items-center gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      animate={false}
                      disabled={i === 0}
                      aria-label={`Move ${guide.title} up`}
                      onClick={() => move(i, -1)}
                    >
                      <ChevronUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      animate={false}
                      disabled={i === chosen.length - 1}
                      aria-label={`Move ${guide.title} down`}
                      onClick={() => move(i, 1)}
                    >
                      <ChevronDown />
                    </Button>
                    <GuidePreviewDialog guide={guide} />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      animate={false}
                      aria-label={`Remove ${guide.title}`}
                      onClick={() => remove(guide.id)}
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <X />
                    </Button>
                  </span>
                </li>
              ))}
            </ol>
          )}

          {full && (
            <p className="text-xs text-muted-foreground">
              A workshop holds at most {LAB_WORKSHOP_LIMITS.guides} guides.
            </p>
          )}
        </div>

        {picking && (
          <div className="grid gap-3 border-t bg-muted/60 p-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Add to these contents
            </p>

            <div className="flex items-center gap-2 rounded-md border border-input bg-field px-2.5">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search guides…"
                autoFocus
                className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>

            {matches.length === 0 ? (
              <p className="px-1 py-3 text-center text-xs text-muted-foreground">
                {available.length === 0
                  ? "Every guide is already in this workshop."
                  : "No guide matches that."}
              </p>
            ) : (
              <ul className="max-h-72 min-w-0 overflow-y-auto">
                {matches.map((guide) => (
                  <li
                    key={guide.id}
                    className="flex items-center gap-1 rounded-md pr-1 transition-colors hover:bg-accent/60"
                  >
                    <button
                      type="button"
                      onClick={() => add(guide.id)}
                      className={cn(
                        "flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md p-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      )}
                    >
                      <Plus className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="block min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          {guide.title}
                        </span>
                        {guide.summary && (
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {guide.summary}
                          </span>
                        )}
                      </span>
                    </button>

                    <GuidePreviewDialog guide={guide} />
                  </li>
                ))}
              </ul>
            )}

            <div className="grid gap-2">
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  or
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>

              <Button
                type="button"
                disabled={busy}
                onClick={() => void saveThenWriteGuide()}
                className="w-full"
              >
                {saving ? <Loader2 className="animate-spin" /> : <PenLine />}
                Write a new guide
              </Button>
              <p className="text-xs leading-relaxed text-muted-foreground">
                This workshop is saved first, so nothing here is lost.
              </p>
            </div>
          </div>
        )}
      </section>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
        <input
          type="checkbox"
          checked={published}
          onChange={(e) => setPublished(e.target.checked)}
          className="mt-0.5 size-4 accent-brand"
        />
        <span>
          <span className="font-medium">Published</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            A published workshop is readable by anyone with the link, while a
            draft is visible only to managers.
          </span>
        </span>
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" variant="brand" disabled={busy}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          {saving ? "Saving…" : editing ? "Save changes" : "Create workshop"}
        </Button>

        <Button asChild variant="ghost">
          <Link href={editing ? `/labs/${workshop.slug}` : "/labs"}>Cancel</Link>
        </Button>

        {editing && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => void removeWorkshop()}
            className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Delete
          </Button>
        )}
      </div>
    </form>
  );
}
