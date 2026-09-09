"use client";

/** Writes and edits a lab guide. */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Columns2,
  Eye,
  Loader2,
  Pencil,
  Save,
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
import { GuideToolbar, type ToolInsert } from "./guide-toolbar";

export function GuideEditor({
  guide,
  usedIn = [],
  addTo,
  within,
}: {
  guide?: LabGuide;
  usedIn?: { slug: string; title: string }[];
  addTo?: { id: string; slug: string; title: string };
  /** The workshop this guide is being edited from — saving returns to it. */
  within?: { slug: string; title: string };
}) {
  const router = useRouter();
  const editing = guide !== undefined;

  const exitTo = (slug: string) =>
    addTo
      ? `/labs/${addTo.slug}/edit`
      : within
        ? `/labs/${within.slug}/${slug}`
        : `/labs/guides/${slug}`;

  const [title, setTitle] = useState(guide?.title ?? "");
  const [summary, setSummary] = useState(guide?.summary ?? "");
  const [body, setBody] = useState(guide?.body ?? "");

  const [tab, setTab] = useState<View>("write");
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [unknownVariables, setUnknownVariables] = useState<string[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tab === "write") return;

    const controller = new AbortController();
    const timer = window.setTimeout(
      async () => {
        try {
          const res = await fetch("/api/lab-guides/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body }),
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`Preview failed (${res.status})`);
          const { html, variables } = await res.json();
          setPreview(html);
          setUnknownVariables(variables?.unknown ?? []);
          setPreviewError(null);
        } catch (err) {
          if (controller.signal.aborted) return;
          setPreviewError(err instanceof Error ? err.message : "Preview failed");
        }
      },
      tab === "split" ? 500 : 350,
    );

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [tab, body]);

  const previewPane = useRef<HTMLDivElement>(null);
  const editedLine = useRef<number | null>(null);

  const lineAt = (text: string, index: number) =>
    text.slice(0, index).split("\n").length;

  useEffect(() => {
    const pane = previewPane.current;
    const line = editedLine.current;
    if (tab !== "split" || preview === null || pane === null || line === null)
      return;

    editedLine.current = null;

    let target: HTMLElement | null = null;
    for (const block of pane.querySelectorAll<HTMLElement>("[data-line]")) {
      if (Number(block.dataset.line) > line) break;
      target = block;
    }
    if (!target) return;

    for (
      let section = target.closest("details");
      section;
      section = section.parentElement?.closest("details") ?? null
    ) {
      section.open = true;
    }

    const view = pane.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    const margin = 24;

    if (box.top >= view.top + margin && box.bottom <= view.bottom - margin)
      return;

    const above = box.top < view.top || box.height > view.height - margin * 2;
    const top =
      pane.scrollTop +
      (above ? box.top - view.top - margin : box.bottom - view.bottom + margin);

    pane.scrollTo({
      top,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [tab, preview]);

  const bodyField = useRef<HTMLTextAreaElement>(null);

  function insertBlock(snippet: string, select?: string) {
    const field = bodyField.current;
    const value = field ? field.value : body;
    const start = field ? field.selectionStart : value.length;
    const end = field ? field.selectionEnd : value.length;

    const before = value.slice(0, start);
    const after = value.slice(end);

    const indent = listIndentAt(before);
    const block = indent ? snippet.replace(/^(?=.)/gm, indent) : snippet;

    const leading =
      before.length === 0 ? "" : "\n\n".slice(before.match(/\n*$/)![0].length);
    const trailing =
      after.length === 0 ? "" : "\n\n".slice(after.match(/^\n*/)![0].length);

    const text = `${leading}${block}${trailing}`;
    const next = `${before}${text}${after}`;
    setBody(next);
    editedLine.current = lineAt(next, start + leading.length);

    if (!field) return;
    const at = select ? block.indexOf(select) : -1;
    const from = at === -1 ? start + text.length : start + leading.length + at;
    const to = at === -1 ? from : from + select!.length;
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(from, to);
    });
  }

  /** A placeholder belongs mid-sentence, so this writes it where the caret is. */
  function insertInline(snippet: string) {
    const field = bodyField.current;
    const value = field ? field.value : body;
    const start = field ? field.selectionStart : value.length;
    const end = field ? field.selectionEnd : value.length;

    const next = `${value.slice(0, start)}${snippet}${value.slice(end)}`;
    setBody(next);
    editedLine.current = lineAt(next, start);

    if (!field) return;
    const at = start + snippet.length;
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(at, at);
    });
  }

  const insert = ({ snippet, select, inline }: ToolInsert) =>
    inline ? insertInline(snippet) : insertBlock(snippet, select);

  const imageMarkdown = (image: { id: string; alt: string; name: string }) =>
    `![${(image.alt || image.name).replace(/[[\]]/g, "")}](/api/lab-images/${image.id})`;

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

  function onBodyPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const file = imageFromTransfer(event.clipboardData);
    if (!file) return;

    event.preventDefault();
    void uploadAndInsert(file);
  }

  function onBodyDrop(event: React.DragEvent<HTMLTextAreaElement>) {
    const file = imageFromTransfer(event.dataTransfer);
    if (!file) return;

    event.preventDefault();
    void uploadAndInsert(file);
  }

  function onBodyDragOver(event: React.DragEvent<HTMLTextAreaElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
  }

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
    editedLine.current = lineAt(next, selectionStart);
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

      let backTo = exitTo(saved.slug);
      if (addTo && !editing) {
        const added = await fetch(`/api/lab-workshops/${addTo.id}/guides`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guideId: saved.id }),
        });
        if (added.ok) {
          const { slug } = await added.json();
          backTo = `/labs/${slug}/edit`;
        } else {
          setError(
            "The guide was saved, but adding it to the workshop failed — add it from the workshop editor.",
          );
          setSaving(false);
          return;
        }
      }

      router.push(backTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the guide");
      setSaving(false);
    }
  }

  async function remove() {
    if (!editing) return;

    const where =
      usedIn.length > 0
        ? `, and out of ${usedIn.length === 1 ? "1 workshop" : `${usedIn.length} workshops`}: ${usedIn
            .map((w) => w.title)
            .join(", ")}`
        : "";

    if (
      !window.confirm(
        `Delete "${guide.title}" for good${where}?`,
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
      router.push(within ? `/labs/${within.slug}` : "/labs/guides");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not delete the guide",
      );
      setDeleting(false);
    }
  }

  const busy = saving || deleting;
  const split = tab === "split";

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
            Renaming this moves its address,{" "}
            <code className="text-foreground">
              {within
                ? `/labs/${within.slug}/${guide.slug}`
                : `/labs/guides/${guide.slug}`}
            </code>
            , and every link follows it.
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
            That workshop is saved, and this guide joins the end of it when you
            save here.
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

      <div className={cn("grid gap-1.5", split && "xl:-mx-26")}>
        <label htmlFor="guide-body" className="text-sm font-medium">
          Guide
        </label>

        <div className="flex items-center justify-between gap-4 rounded-lg border p-1">
          <div className="flex flex-wrap items-center gap-0.5">
            <GuideToolbar onInsert={insert} />

            <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />

            <ImagePickerDialog
              onInsert={(image) =>
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

          <div
            role="tablist"
            aria-label="Editor view"
            className="flex items-center gap-1"
          >
            {VIEWS.map(({ value, label, icon: Icon }) => (
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
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className={cn(split && "grid gap-3 lg:grid-cols-2")}>
          {tab !== "preview" && (
            <textarea
              id="guide-body"
              ref={bodyField}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                editedLine.current = lineAt(
                  e.target.value,
                  e.target.selectionStart,
                );
              }}
              onKeyDown={onBodyKeyDown}
              onPaste={onBodyPaste}
              onDrop={onBodyDrop}
              onDragOver={onBodyDragOver}
              maxLength={LAB_GUIDE_LIMITS.body}
              spellCheck={false}
              placeholder={PLACEHOLDER}
              className={cn(
                "w-full rounded-md border border-input bg-field p-3 font-mono text-[13px] leading-relaxed shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                split ? "h-[40vh] resize-none lg:h-[70vh]" : "min-h-112",
              )}
            />
          )}

          {tab !== "write" && (
            <div
              ref={previewPane}
              className={cn(
                "rounded-md border p-5",
                split
                  ? "h-[40vh] overflow-y-auto lg:h-[70vh]"
                  : "min-h-112",
              )}
            >
              {previewError !== null && (
                <p className="mb-3 text-sm text-destructive">{previewError}</p>
              )}
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

        {tab !== "preview" && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Markdown, with fenced code (
            <code className="text-foreground">```bash</code>), callouts (
            <code className="text-foreground">:::tip</code>) and collapsible
            sections (<code className="text-foreground">:::details</code>) — the
            toolbar menus insert an example of each.
          </p>
        )}

        {tab !== "preview" && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Write <code className="text-foreground">{"{{project}}"}</code> in a
            sentence, a command or a link and each reader sees their own, taken
            from the row they claimed on their event page. The{" "}
            <span className="text-foreground">Placeholder</span> menu lists every
            one; the preview leaves them as written.
          </p>
        )}

        {unknownVariables.length > 0 && (
          <p className="text-xs leading-relaxed text-amber-600 dark:text-amber-500">
            Nothing fills in{" "}
            {unknownVariables.map((name, i) => (
              <span key={name}>
                {i > 0 && ", "}
                <code>{`{{${name}}}`}</code>
              </span>
            ))}{" "}
            — readers will see that written out. Check the spelling against the
            Placeholder menu.
          </p>
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
                  ? exitTo(guide.slug)
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

const LIST_MARKER = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(?=\S)/;

const FENCE = /^[ \t]*(?:`{3,}|~{3,})/;

function listIndentAt(before: string): string {
  const lines = before.split("\n");

  if (lines.filter((line) => FENCE.test(line)).length % 2 === 1) return "";

  let i = lines.length - 1;
  while (i >= 0 && lines[i].trim().length === 0) i--;
  if (i < 0) return "";

  const marker = lines[i].match(LIST_MARKER);
  if (marker) return " ".repeat(marker[1].length + 2);

  const indent = lines[i].match(/^[ \t]*/)![0];
  if (indent.length === 0) return "";

  for (let j = i - 1; j >= 0; j--) {
    const line = lines[j];
    if (line.trim().length === 0) continue;
    if (LIST_MARKER.test(line)) return indent;
    if (/^[ \t]/.test(line)) continue;
    return "";
  }
  return "";
}

type View = "write" | "split" | "preview";

const VIEWS: { value: View; label: string; icon: LucideIcon }[] = [
  { value: "write", label: "Write", icon: Pencil },
  { value: "split", label: "Split", icon: Columns2 },
  { value: "preview", label: "Preview", icon: Eye },
];

const PLACEHOLDER = `## Before you start

What the attendee needs open in front of them.

\`\`\`bash
gcloud auth login
\`\`\`

## Step 1 — …
`;
