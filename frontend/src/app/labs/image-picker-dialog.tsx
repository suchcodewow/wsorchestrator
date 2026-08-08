"use client";

import { useEffect, useRef, useState } from "react";
import {
  ImageIcon,
  Loader2,
  Pencil,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { LAB_IMAGE_LIMITS } from "@/db/schema";
import { uploadImageFile, type PickerImage } from "@/lib/lab-image-upload";
import { cn } from "@/lib/utils";

/** What the editor needs to write a Markdown reference. */
export type InsertedImage = { id: string; name: string; alt: string };

const MAX_MB = LAB_IMAGE_LIMITS.bytes / (1024 * 1024);

/** "812 KB", "1.4 MB" — a size an author can judge a page weight by. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Browse the image library and put one in the guide.
 *
 * The library is global rather than per-guide, for the same reason guides are
 * global rather than per-workshop: the console screenshot that opens one lab is
 * the same screenshot in the next one, and a per-guide library would mean
 * uploading it again every time.
 *
 * Nothing here is loaded until the dialog is opened — an editor is mostly used
 * to write prose, and a grid of screenshots nobody asked for is a page-load
 * cost on every visit to pay for a button that may not be pressed.
 */
export function ImagePickerDialog({
  onInsert,
}: {
  /** Called with the chosen image; the editor decides where it lands. */
  onInsert: (image: InsertedImage) => void;
}) {
  const [open, setOpen] = useState(false);
  const [images, setImages] = useState<PickerImage[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  /**
   * Whether a load is in flight — tracked on its own rather than inferred from
   * an empty list.
   *
   * These are three different states that look alike if you conflate them:
   * still loading, loaded and genuinely empty, and failed. Reading "loading"
   * off `images === null` meant a failed request never cleared it, so the
   * spinner turned forever underneath the error message.
   */
  const [loading, setLoading] = useState(true);
  /** First load of this dialog session shouldn't sit behind the debounce. */
  const loaded = useRef(false);

  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  /** The image whose name is being edited in place, and the text so far. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  /**
   * Fetch the library, filtered by the search box.
   *
   * Debounced and abortable, like the editor's own preview: this runs on every
   * keystroke otherwise, and a slow response landing after a faster one would
   * leave the grid showing results for a query the author has moved on from.
   */
  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();

    const timer = window.setTimeout(
      async () => {
        // Set when the request actually starts rather than in the effect body:
        // the results already on screen stay put through the debounce instead
        // of blinking to a spinner on every keystroke.
        setLoading(true);
        try {
          const res = await fetch(
            `/api/lab-images?q=${encodeURIComponent(query)}`,
            { signal: controller.signal },
          );
          if (!res.ok) {
            // The route sends a message with the ones it expects; anything
            // else (a proxy, a crash) only has its status to go on.
            const body = await res.json().catch(() => null);
            throw new Error(
              body?.message ?? `Could not load images (${res.status})`,
            );
          }
          const data = await res.json();
          setImages(data.images);
          setError(null);
        } catch (err) {
          if (controller.signal.aborted) return;
          setImages([]);
          setError(err instanceof Error ? err.message : "Could not load images");
        } finally {
          // Not on abort: another request is already in flight behind this
          // one, and clearing the flag here would flash the empty state.
          if (!controller.signal.aborted) {
            setLoading(false);
            loaded.current = true;
          }
        }
      },
      loaded.current ? 250 : 0,
    );

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, query]);

  function choose(image: PickerImage) {
    onInsert({ id: image.id, name: image.name, alt: image.alt || image.name });
    setOpen(false);
  }

  async function upload() {
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      // Shared with the editor's paste handler, so an image is downscaled the
      // same way whichever door it came in through. The name is what the
      // library is searched by; the filename is a reasonable default but a
      // poor one to be stuck with.
      const image = await uploadImageFile(file, {
        name: name.trim() || file.name,
        alt: name.trim() || file.name,
      });

      // Straight into the guide: uploading an image mid-sentence is done
      // because it is wanted *here*, and making the author then find it in the
      // grid they just added to is a step for its own sake.
      setImages((prev) => [image, ...prev]);
      setFile(null);
      setName("");
      if (fileInput.current) fileInput.current.value = "";
      choose(image);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  /**
   * Save a new name for an image.
   *
   * The counterpart to auto-naming on paste: a screenshot filed under the
   * guide's title gets a real name here, at a moment when the author is
   * looking at the library rather than mid-sentence.
   */
  async function saveName(image: PickerImage) {
    const next = draftName.trim();
    if (next.length === 0 || next === image.name) {
      setRenaming(null);
      return;
    }

    setError(null);
    try {
      const res = await fetch(`/api/lab-images/${image.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      if (!res.ok) throw new Error(`Could not rename (${res.status})`);

      const { image: saved } = await res.json();
      setImages((prev) => prev.map((i) => (i.id === saved.id ? saved : i)));
      setRenaming(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename");
    }
  }

  async function remove(image: PickerImage) {
    if (
      !window.confirm(
        `Delete "${image.name}"? Guides already using it will show a broken image.`,
      )
    ) {
      return;
    }

    setError(null);
    try {
      const res = await fetch(`/api/lab-images/${image.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Could not delete (${res.status})`);
      setImages((prev) => prev.filter((i) => i.id !== image.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title="Insert an image"
          className="text-muted-foreground hover:text-foreground"
        >
          <ImageIcon />
          Image
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Insert an image</DialogTitle>
          <DialogDescription>
            Click one to drop it into the guide where the cursor is. PNG, JPEG,
            GIF and WebP, up to {MAX_MB} MB.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-md border px-2.5">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search images by name…"
              autoFocus
              className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="cursor-pointer text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>

        {/*
          Upload sits above the grid rather than behind a second toggle: it is
          half of what this dialog is for, and an author who has just taken a
          screenshot should not have to find a control to say so.
        */}
        <div className="grid gap-2 rounded-lg border border-dashed p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(e) => {
                const chosen = e.target.files?.[0] ?? null;
                setFile(chosen);
                // Offer the filename, minus its extension, as the name.
                if (chosen && name.trim().length === 0) {
                  setName(chosen.name.replace(/\.[^.]+$/, ""));
                }
              }}
              className="max-w-64 flex-1 cursor-pointer text-xs text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-input file:bg-transparent file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-foreground hover:file:bg-accent"
            />
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={LAB_IMAGE_LIMITS.name}
              placeholder="Name it — this is what search finds"
              className="h-8 min-w-48 flex-1 text-sm"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!file || uploading}
              onClick={() => void upload()}
            >
              {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          </div>
          {file && (
            <p className="text-xs text-muted-foreground">
              {file.name} · {formatBytes(file.size)}
              {file.size > LAB_IMAGE_LIMITS.bytes && (
                <span className="text-destructive"> · over {MAX_MB} MB</span>
              )}
            </p>
          )}
        </div>

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="max-h-[45vh] min-h-40 overflow-y-auto pr-1">
          {loading ? (
            <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading…
            </p>
          ) : error ? (
            // The message is already above; repeating it here would say the
            // same thing twice in one dialog.
            <p className="py-8 text-center text-sm text-muted-foreground">
              The library could not be loaded.
            </p>
          ) : images.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {query.trim()
                ? "No image matches that name."
                : "No images yet — upload the first one above."}
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {images.map((image) => (
                <li key={image.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => choose(image)}
                    title={`Insert ${image.name}`}
                    className={cn(
                      "block w-full cursor-pointer overflow-hidden rounded-lg border bg-card/60 text-left outline-none transition-colors",
                      "hover:border-brand-border/70 hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    )}
                  >
                    {/*
                      A plain <img>, not next/image: these are arbitrary
                      uploads served from a dynamic route, so there is nothing
                      for the optimiser to pre-size and no layout win to be had
                      inside a fixed-height thumbnail box.
                    */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/lab-images/${image.id}`}
                      alt={image.alt || image.name}
                      loading="lazy"
                      className="h-24 w-full bg-muted object-contain"
                    />
                    {/*
                      The name sits outside the insert button while it is being
                      edited — a text field nested in a button cannot be typed
                      into without the click landing on the button underneath.
                    */}
                    {renaming !== image.id && (
                      <span className="block truncate px-2.5 pt-2 text-xs font-medium">
                        {image.name}
                      </span>
                    )}
                    <span className="block px-2.5 pb-2 text-xs text-muted-foreground">
                      {formatBytes(image.bytes)}
                    </span>
                  </button>

                  {renaming === image.id && (
                    <div className="absolute inset-x-2 bottom-7">
                      <Input
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        maxLength={LAB_IMAGE_LIMITS.name}
                        autoFocus
                        // Enter commits, Escape abandons — the two things a
                        // rename-in-place has to answer without a pair of
                        // buttons crowding a thumbnail.
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void saveName(image);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            setRenaming(null);
                          }
                        }}
                        onBlur={() => void saveName(image)}
                        // Solid, not the Input default of `bg-transparent`:
                        // this floats over the thumbnail, and a see-through
                        // field puts the name on top of the picture it names.
                        className="h-7 bg-background text-xs shadow-sm"
                      />
                    </div>
                  )}

                  <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      animate={false}
                      aria-label={`Rename ${image.name}`}
                      onClick={() => {
                        setRenaming(image.id);
                        setDraftName(image.name);
                      }}
                      className="bg-background/80 text-muted-foreground backdrop-blur-sm hover:text-foreground"
                    >
                      <Pencil />
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      animate={false}
                      aria-label={`Delete ${image.name}`}
                      onClick={() => void remove(image)}
                      className="bg-background/80 text-muted-foreground backdrop-blur-sm hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
