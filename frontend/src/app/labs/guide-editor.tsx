"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Code,
  Eye,
  Heading2,
  Info,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Pencil,
  Save,
  Table,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { LabGuideBody } from "@/components/lab-guide-body";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LAB_GUIDE_LIMITS, type LabGuide } from "@/db/schema";
import { imageFromTransfer, uploadImageFile } from "@/lib/lab-image-upload";
import { cn } from "@/lib/utils";
import { ImagePickerDialog } from "./image-picker-dialog";

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

  const [tab, setTab] = useState<"write" | "preview">("write");
  const [preview, setPreview] = useState<string | null>(null);
  /** A pasted or dropped image on its way into the library. */
  const [uploadingImage, setUploadingImage] = useState(false);
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
   * The body field itself, so the toolbar can write at the caret.
   *
   * A textarea keeps its own selection, and React does not model it — an
   * insertion has to read `selectionStart` off the element, not off state.
   */
  const bodyField = useRef<HTMLTextAreaElement>(null);

  /**
   * Insert a block-level snippet at the caret, replacing any selection.
   *
   * Markdown only treats an image as its own block if a blank line separates it
   * from the prose around it — but padding it unconditionally puts empty lines
   * at the top of an empty guide and triples them mid-document. So the padding
   * is worked out from what is actually on either side of the caret, and only
   * the newlines that are missing get added.
   *
   * The caret ends up *after* what was inserted, so an author who drops an
   * image in mid-sentence carries on writing below it. Focus is returned by
   * hand because the insertion came from a dialog, which took focus with it.
   *
   * `select` names a piece of the snippet to leave highlighted instead — the
   * placeholder in a template, so the first thing typed replaces the example
   * text rather than landing next to it.
   */
  function insertBlock(snippet: string, select?: string) {
    const field = bodyField.current;
    // No field to measure — the preview tab is showing, so the textarea is not
    // mounted. Append, which is where the caret would have been anyway.
    const value = field ? field.value : body;
    const start = field ? field.selectionStart : value.length;
    const end = field ? field.selectionEnd : value.length;

    const before = value.slice(0, start);
    const after = value.slice(end);

    // At the very start of the document nothing needs to come first; otherwise
    // top up whatever newlines the text already ends with to two.
    const leading =
      before.length === 0 ? "" : "\n\n".slice(before.match(/\n*$/)![0].length);
    const trailing =
      after.length === 0 ? "" : "\n\n".slice(after.match(/^\n*/)![0].length);

    const text = `${leading}${snippet}${trailing}`;
    setBody(`${before}${text}${after}`);

    if (!field) return;
    // Offsets are measured against the padded text, so the leading newlines
    // count towards where the placeholder ended up.
    const at = select ? snippet.indexOf(select) : -1;
    const from = at === -1 ? start + text.length : start + leading.length + at;
    const to = at === -1 ? from : from + select!.length;
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(from, to);
    });
  }

  /** Markdown for one stored image, with the alt text made safe to embed. */
  const imageMarkdown = (image: { id: string; alt: string; name: string }) =>
    `![${(image.alt || image.name).replace(/[[\]]/g, "")}](/api/lab-images/${image.id})`;

  /**
   * Take an image straight from the clipboard or a drop into the library.
   *
   * The name comes from the guide's title because the clipboard has nothing
   * better to offer — a pasted screenshot is a `File` called `image.png` in
   * every browser — and the server makes it unique, so eight screenshots in one
   * guide do not become eight identically-named rows. Renaming later is a
   * pencil in the picker; interrupting a paste to ask would be the wrong moment
   * for a question, which is the whole reason paste is worth having.
   *
   * The Markdown goes in only once the upload has succeeded. A reference
   * written optimistically would be left pointing at nothing on a failure, in a
   * document the author is still typing into.
   */
  async function uploadAndInsert(file: File) {
    setUploadingImage(true);
    setError(null);
    try {
      const base = title.trim() || "Pasted image";
      const image = await uploadImageFile(file, {
        name: base,
        alt: base,
        autoName: true,
      });
      insertBlock(imageMarkdown(image));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "That image could not be uploaded",
      );
    } finally {
      setUploadingImage(false);
    }
  }

  /**
   * Paste an image to upload it. Anything else pastes as it always did.
   *
   * `preventDefault` runs only once an actual image file has been found —
   * otherwise the browser's own paste is cancelled for ordinary text, and
   * copying a paragraph into a guide would silently do nothing.
   */
  function onBodyPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const file = imageFromTransfer(event.clipboardData);
    if (!file) return;

    event.preventDefault();
    void uploadAndInsert(file);
  }

  /** Dropping an image file does the same as pasting one. */
  function onBodyDrop(event: React.DragEvent<HTMLTextAreaElement>) {
    const file = imageFromTransfer(event.dataTransfer);
    if (!file) return;

    event.preventDefault();
    void uploadAndInsert(file);
  }

  /**
   * A drop only fires at all if the drag over the target was cancelled, so this
   * has to say "yes, droppable" for image drags — and stay out of the way of
   * everything else, including dragging selected text around inside the field.
   */
  function onBodyDragOver(event: React.DragEvent<HTMLTextAreaElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
  }

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
          body: JSON.stringify({ title, summary, body }),
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
        {editing && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            The address follows the title:{" "}
            <code className="text-foreground">/labs/guides/{guide.slug}</code>{" "}
            moves when you rename this. Links into the workshops it sits in are
            built fresh, so they follow it.
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
        <label htmlFor="guide-body" className="text-sm font-medium">
          Guide
        </label>

        {/*
          The toolbar. Insert controls on the left, the view switch on the
          right — the two do different kinds of thing, and a control that
          changes the document should not sit flush against one that only
          changes what you are looking at.
        */}
        <div className="flex items-center justify-between gap-4 rounded-lg border p-1">
          <div className="flex flex-wrap items-center gap-0.5">
            {SNIPPETS.map(({ label, icon: Icon, snippet, select }) => (
              <Button
                key={label}
                type="button"
                variant="ghost"
                size="icon"
                title={`Insert ${label.toLowerCase()}`}
                aria-label={`Insert ${label.toLowerCase()}`}
                onClick={() => insertBlock(snippet, select)}
                className="size-8 text-muted-foreground hover:text-foreground"
              >
                <Icon />
              </Button>
            ))}

            {/* The snippets write themselves in; the image button opens a
                dialog first. Different enough to be worth a line between. */}
            <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />

            <ImagePickerDialog
              onInsert={(image) =>
                // Markdown, not HTML: the pipeline drops raw HTML from a guide
                // body, so an <img> tag written here would silently vanish on
                // render. Brackets are stripped from the alt text because they
                // would close it early and leave the rest as loose prose.
                insertBlock(imageMarkdown(image))
              }
            />

            {uploadingImage && (
              <span
                role="status"
                className="flex items-center gap-1.5 pl-1 text-xs text-muted-foreground"
              >
                <Loader2 className="size-3.5 animate-spin" />
                Uploading image…
              </span>
            )}
          </div>

          {/* Radio group rather than links: this switches a view, and both
              halves have to survive a round trip through the same state. */}
          <div
            role="tablist"
            aria-label="Editor view"
            className="flex items-center gap-1"
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
              ref={bodyField}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={onBodyKeyDown}
              onPaste={onBodyPaste}
              onDrop={onBodyDrop}
              onDragOver={onBodyDragOver}
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
              to label the block with a filename. The toolbar drops a worked
              example in at the cursor — table, list, callout — with the
              placeholder text selected to type over. Paste or drop an image
              straight in, or pick an existing one from the same toolbar. Tab
              indents; Escape then Tab moves on.
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

/**
 * The insert menu: the block-level Markdown whose exact punctuation nobody
 * should have to remember, above all the table.
 *
 * Each one is a worked example rather than empty scaffolding. A table with
 * plausible rows in it shows what a table is *for* in a lab guide, and
 * overwriting words is faster than typing pipes and dashes into the right
 * places. `select` is the part left highlighted after the insertion, so the
 * example text is gone the moment the author starts typing over it.
 *
 * The callout is a blockquote with a bold label, because that is what this
 * renderer has: the pipeline is GFM without an admonition plugin, so a
 * `> [!NOTE]` written here would render the marker as literal text.
 */
const SNIPPETS: {
  label: string;
  icon: LucideIcon;
  snippet: string;
  select: string;
}[] = [
  {
    label: "Heading",
    icon: Heading2,
    snippet: "## Section title",
    select: "Section title",
  },
  {
    label: "Bulleted list",
    icon: List,
    snippet: `- What the attendee needs open
- Where they are starting from
- What they will have at the end`,
    select: "What the attendee needs open",
  },
  {
    label: "Numbered list",
    icon: ListOrdered,
    snippet: `1. Open the console
2. Create the resource
3. Check that it came up`,
    select: "Open the console",
  },
  {
    label: "Task list",
    icon: ListChecks,
    snippet: `- [ ] Something to tick off
- [ ] Something else to tick off`,
    select: "Something to tick off",
  },
  {
    label: "Table",
    icon: Table,
    snippet: `| Setting | Value | Notes |
| --- | --- | --- |
| Region | \`us-central1\` | Match the project default |
| Machine type | \`e2-standard-4\` | Smaller runs out of memory |`,
    select: "Setting",
  },
  {
    label: "Code block",
    icon: Code,
    snippet: `\`\`\`bash title="setup.sh"
gcloud auth login
\`\`\``,
    select: "gcloud auth login",
  },
  {
    label: "Callout",
    icon: Info,
    snippet: `> **Note**
>
> What to know before carrying on — a prerequisite or a gotcha.`,
    select: "What to know before carrying on — a prerequisite or a gotcha.",
  },
];

const PLACEHOLDER = `## Before you start

What the attendee needs open in front of them.

\`\`\`bash
gcloud auth login
\`\`\`

## Step 1 — …
`;
