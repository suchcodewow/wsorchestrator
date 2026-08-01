"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, Loader2, Pencil, Save, Trash2 } from "lucide-react";
import { LabGuideBody } from "@/components/lab-guide-body";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LAB_GUIDE_LIMITS, type LabGuide } from "@/db/schema";
import { cn } from "@/lib/utils";

/**
 * Write and edit a lab guide.
 *
 * Markdown in a textarea, deliberately — the guides are code-heavy and full of
 * fenced blocks, and every rich-text editor ever pointed at that problem has
 * ended up fighting the author over indentation. What the editor does owe them
 * is certainty about the result, which is what the preview tab is for: it is
 * rendered by the server, through the same pipeline as the published page.
 */
export function GuideEditor({
  guide,
  usedIn = [],
  addTo,
}: {
  guide?: LabGuide;
  /** Workshops this guide appears in. Empty for a new one. */
  usedIn?: { slug: string; title: string }[];
  /**
   * The workshop this guide is being written *for*, when the author came here
   * from its editor. A new guide is appended to it on save, and every way out
   * of this form leads back there — including Cancel, since the workshop was
   * saved on the way in and is waiting.
   */
  addTo?: { id: string; slug: string; title: string };
}) {
  const router = useRouter();
  const editing = guide !== undefined;

  /** Where this form returns to: the workshop it came from, or the guide. */
  const exitTo = (slug: string) =>
    addTo ? `/labs/${addTo.slug}/edit` : `/labs/guides/${slug}`;

  const [title, setTitle] = useState(guide?.title ?? "");
  const [summary, setSummary] = useState(guide?.summary ?? "");
  const [body, setBody] = useState(guide?.body ?? "");
  const [published, setPublished] = useState(guide?.published ?? false);

  const [tab, setTab] = useState<"write" | "preview">("write");
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Render on the way into the preview, and again as the body changes while it
  // is open. Debounced — this is a request per keystroke otherwise — and
  // cancelled on the way out, so switching back to Write mid-flight does not
  // leave a stale render to land later.
  useEffect(() => {
    if (tab !== "preview") return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/lab-guides/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Preview failed (${res.status})`);
        const { html } = await res.json();
        setPreview(html);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Preview failed");
      }
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [tab, body]);

  /**
   * Tab indents inside the body instead of leaving the field. A guide is
   * nothing but indented code blocks, and a textarea that cannot indent is not
   * usable for one — but the escape has to stay obvious, so Escape returns the
   * key to its usual job before the author needs to look for it.
   */
  const tabTraps = useRef(true);

  function onBodyKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      tabTraps.current = false;
      return;
    }
    if (event.key !== "Tab" || !tabTraps.current) return;

    event.preventDefault();
    const field = event.currentTarget;
    const { selectionStart, selectionEnd, value } = field;
    const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
    setBody(next);
    // React re-renders from state, so the caret has to be put back by hand.
    requestAnimationFrame(() => {
      field.selectionStart = field.selectionEnd = selectionStart + 2;
    });
  }

  async function save() {
    if (title.trim().length === 0) {
      setError("Give the guide a title.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        editing ? `/api/lab-guides/${guide.id}` : "/api/lab-guides",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, summary, body, published }),
        },
      );
      if (!res.ok) throw new Error(`Could not save the guide (${res.status})`);

      const { guide: saved } = await res.json();

      // Written for a workshop: put it at the end of that workshop before
      // leaving, so the author returns to a list that already has it in.
      let backTo = exitTo(saved.slug);
      if (addTo && !editing) {
        const added = await fetch(`/api/lab-workshops/${addTo.id}/guides`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guideId: saved.id }),
        });
        if (added.ok) {
          // The workshop's slug may have moved since we left it — a draft's
          // does, whenever its title changes.
          const { slug } = await added.json();
          backTo = `/labs/${slug}/edit`;
        } else {
          // The guide exists and is saved; only the filing failed. Say so
          // rather than silently returning to a workshop without it in.
          setError(
            "The guide was saved, but could not be added to the workshop. Add it from the workshop editor.",
          );
          setSaving(false);
          return;
        }
      }

      // Otherwise to the guide itself: the slug may have just changed under a
      // rename, and seeing the published page is how an author knows they are
      // done.
      router.push(backTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the guide");
      setSaving(false);
    }
  }

  async function remove() {
    if (!editing) return;

    // Deleting a shared guide takes it out of every workshop that used it, so
    // the confirmation says which — "this cannot be undone" is not the part
    // that surprises somebody here.
    const where =
      usedIn.length > 0
        ? ` It will be removed from ${usedIn.length === 1 ? "1 workshop" : `${usedIn.length} workshops`}: ${usedIn
            .map((w) => w.title)
            .join(", ")}.`
        : "";

    if (
      !window.confirm(
        `Delete "${guide.title}"? This cannot be undone.${where}`,
      )
    ) {
      return;
    }

    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/lab-guides/${guide.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Could not delete the guide (${res.status})`);
      router.push("/labs/guides");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not delete the guide",
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
        <label htmlFor="guide-title" className="text-sm font-medium">
          Title
        </label>
        <Input
          id="guide-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={LAB_GUIDE_LIMITS.title}
          placeholder="e.g. Deploy your first pipeline"
          required
          autoFocus={!editing}
        />
        {editing && guide.published && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            The address stays <code className="text-foreground">/labs/guides/{guide.slug}</code> —
            it was published under that URL, and moving it now would break every
            link already handed out.
          </p>
        )}
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="guide-summary" className="text-sm font-medium">
          Summary
        </label>
        <Input
          id="guide-summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          maxLength={LAB_GUIDE_LIMITS.summary}
          placeholder="One line, shown on the list of guides."
        />
      </div>

      {/*
        Where this guide is used. Editing here edits it in every workshop at
        once, which is the point of guides being reusable and also the way to
        change eight rooms' material by accident — so it is said before the
        body, not after it.
      */}
      {/*
        Where this one is going. Shown for a new guide written from a workshop
        editor, which saved itself on the way here — that is worth saying out
        loud, because the author left a form full of unsaved-looking work.
      */}
      {addTo && !editing && (
        <div className="rounded-lg border border-brand-border/60 bg-brand/5 p-3 text-xs leading-relaxed">
          <p className="font-medium">
            Writing for{" "}
            <Link
              href={`/labs/${addTo.slug}/edit`}
              className="text-brand underline underline-offset-2"
            >
              {addTo.title}
            </Link>
          </p>
          <p className="mt-1 text-muted-foreground">
            That workshop has been saved, and this guide is added to the end of
            it when you save here. Leaving without saving loses only this guide.
          </p>
        </div>
      )}

      {usedIn.length > 0 && (
        <div className="rounded-lg border border-brand-border/60 bg-brand/5 p-3 text-xs leading-relaxed">
          <p className="font-medium">
            In {usedIn.length === 1 ? "1 workshop" : `${usedIn.length} workshops`}
          </p>
          <p className="mt-1 text-muted-foreground">
            Changes here apply everywhere it appears:{" "}
            {usedIn.map((workshop, i) => (
              <span key={workshop.slug}>
                {i > 0 && ", "}
                <Link
                  href={`/labs/${workshop.slug}`}
                  className="text-brand underline underline-offset-2"
                >
                  {workshop.title}
                </Link>
              </span>
            ))}
            .
          </p>
        </div>
      )}

      <div className="grid gap-1.5">
        <div className="flex items-end justify-between gap-4">
          <label htmlFor="guide-body" className="text-sm font-medium">
            Guide
          </label>

          {/* Radio group rather than links: this switches a view, and both
              halves have to survive a round trip through the same state. */}
          <div
            role="tablist"
            aria-label="Editor view"
            className="flex items-center gap-1 rounded-lg border p-0.5"
          >
            {(["write", "preview"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  tab === value
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {value === "write" ? (
                  <Pencil className="size-3.5" />
                ) : (
                  <Eye className="size-3.5" />
                )}
                {value === "write" ? "Write" : "Preview"}
              </button>
            ))}
          </div>
        </div>

        {tab === "write" ? (
          <>
            <textarea
              id="guide-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={onBodyKeyDown}
              maxLength={LAB_GUIDE_LIMITS.body}
              spellCheck={false}
              placeholder={PLACEHOLDER}
              className="min-h-112 w-full rounded-md border border-input bg-transparent p-3 font-mono text-[13px] leading-relaxed shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Markdown, with tables and task lists. Fence code with the language
              for highlighting — <code className="text-foreground">```bash</code>{" "}
              — and add{" "}
              <code className="text-foreground">title=&quot;main.tf&quot;</code>{" "}
              to label the block with a filename. Tab indents; Escape then Tab
              moves on.
            </p>
          </>
        ) : (
          <div className="min-h-112 rounded-md border p-5">
            {preview === null ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Rendering…
              </p>
            ) : preview.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing to preview yet.
              </p>
            ) : (
              <LabGuideBody html={preview} />
            )}
          </div>
        )}
      </div>

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
            A published guide is readable by anyone with the link, signed in or
            not. A draft is visible only to managers.
          </span>
        </span>
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" variant="brand" disabled={busy}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          {saving ? "Saving…" : editing ? "Save changes" : "Create guide"}
        </Button>

        <Button asChild variant="ghost">
          <Link
            href={
              addTo
                ? `/labs/${addTo.slug}/edit`
                : editing
                  ? `/labs/guides/${guide.slug}`
                  : "/labs/guides"
            }
          >
            {addTo ? "Back to the workshop" : "Cancel"}
          </Link>
        </Button>

        {editing && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => void remove()}
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

const PLACEHOLDER = `## Before you start

What the attendee needs open in front of them.

\`\`\`bash
gcloud auth login
\`\`\`

## Step 1 — …
`;
