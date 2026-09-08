"use client";

/** Browses the image library and puts one in a guide. */

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

export type InsertedImage = { id: string; name: string; alt: string };

const MAX_MB = LAB_IMAGE_LIMITS.bytes / (1024 * 1024);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImagePickerDialog({
  onInsert,
}: {
  onInsert: (image: InsertedImage) => void;
}) {
  const [open, setOpen] = useState(false);
  const [images, setImages] = useState<PickerImage[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loaded = useRef(false);

  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();

    const timer = window.setTimeout(
      async () => {
        setLoading(true);
        try {
          const res = await fetch(
            `/api/lab-images?q=${encodeURIComponent(query)}`,
            { signal: controller.signal },
          );
          if (!res.ok) {
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
      const image = await uploadImageFile(file, {
        name: name.trim() || file.name,
        alt: name.trim() || file.name,
      });

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
        `Delete "${image.name}", leaving a broken image in any guide using it?`,
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
            Click one to drop it into the guide (PNG, JPEG, GIF or WebP, up to{" "}
            {MAX_MB} MB).
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-md border border-input bg-field px-2.5">
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

        <div className="grid gap-2 rounded-lg border border-dashed p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(e) => {
                const chosen = e.target.files?.[0] ?? null;
                setFile(chosen);
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
            <p className="py-8 text-center text-sm text-muted-foreground">
              The library could not be loaded.
            </p>
          ) : images.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {query.trim()
                ? "No image matches that name."
                : "No images yet."}
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
                      "block w-full cursor-pointer overflow-hidden rounded-lg border bg-card/60 dark:bg-card text-left outline-none transition-colors",
                      "hover:border-brand-border/70 hover:bg-accent/40 dark:hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/lab-images/${image.id}`}
                      alt={image.alt || image.name}
                      loading="lazy"
                      className="h-24 w-full bg-muted object-contain"
                    />
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
                        className="h-7 text-xs shadow-sm"
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
