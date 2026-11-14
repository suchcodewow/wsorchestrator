"use client";

/**
 * A presentation's slides, in deck order: a click on one presents from it.
 * Slides whose pictures are not here yet are fetched from Google one at a time
 * while the page is open, so presenting later shows each at once.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, ExternalLink, LoaderCircle, MoreHorizontal, NotebookText, Pencil, Play, RefreshCw, Trash2 } from "lucide-react";
import { usePresenter } from "@/components/presentations/player";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { riseChild, staggerParent } from "@/lib/motion";
import { presentedSlides, slideImageUrl } from "@/lib/presentations/live";
import type { Presentation, PresentationSlide } from "@/lib/presentations/presentations";
import { cn } from "@/lib/utils";
import { formatSynced } from "../format";
import { RenameDialog } from "./rename-dialog";

export function PresentationView({ presentation, canManage }: { presentation: Presentation; canManage: boolean }) {
  const router = useRouter();
  const { id, name, slides } = presentation;
  const { present, player } = usePresenter(id, slides);
  const shown = presentedSlides(slides);
  const preparing = usePrepare(id, slides);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [renaming, setRenaming] = useState(false);

  async function sync() {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/presentations/${id}/sync`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage({ text: body?.message ?? `Could not read the deck (${res.status}).`, error: true });
        return;
      }
      setMessage({
        text: body.changed === 0 ? "No slides changed." : `${body.changed} ${body.changed === 1 ? "slide" : "slides"} changed.`,
      });
      router.refresh();
    } catch {
      setMessage({ text: "Could not reach the server.", error: true });
    } finally {
      setSyncing(false);
    }
  }

  async function remove() {
    const ok = await confirmDialog({
      title: `Delete “${name}”?`,
      description: "The deck in Google Slides is not touched.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/presentations/${id}`, { method: "DELETE" });
    if (res.ok) router.push("/presentations");
    else setMessage({ text: `Could not delete it (${res.status}).`, error: true });
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild}>
        <Link href="/presentations" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Presentations
        </Link>
      </motion.div>

      <motion.div variants={riseChild} className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-3xl font-medium tracking-tight">{name}</h1>
          <p className="text-sm text-muted-foreground" suppressHydrationWarning>
            {shown.length} {shown.length === 1 ? "slide" : "slides"}
            {shown.length !== slides.length && ` and ${slides.length - shown.length} skipped`} · read from Google{" "}
            {formatSynced(presentation.syncedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="brand" disabled={shown.length === 0} onClick={() => present()}>
            <Play />
            Present
          </Button>
          <Button variant="outline" asChild>
            <a href={`/presentations/${id}/notes`} target="_blank" rel="noopener">
              <NotebookText />
              Speaker notes
            </a>
          </Button>
          {canManage && (
            <Button variant="outline" disabled={syncing} onClick={() => void sync()}>
              <RefreshCw className={cn(syncing && "animate-spin")} />
              Refresh from Google
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <a href={presentation.googleUrl} target="_blank" rel="noopener">
                  <ExternalLink />
                  Open in Google Slides
                </a>
              </DropdownMenuItem>
              {canManage && (
                <>
                  <DropdownMenuItem onSelect={() => setRenaming(true)}>
                    <Pencil />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive" onSelect={() => void remove()}>
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </motion.div>

      {(message || preparing.left > 0 || preparing.failed) && (
        <motion.div variants={riseChild} className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {message && (
            <p role={message.error ? "alert" : "status"} className={cn(message.error ? "text-destructive" : "text-muted-foreground")}>
              {message.text}
            </p>
          )}
          {preparing.left > 0 && (
            <p className="inline-flex items-center gap-1.5 text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" />
              Getting slides from Google: {preparing.done} of {preparing.done + preparing.left}
            </p>
          )}
          {preparing.failed && preparing.failed !== message?.text && <p className="text-destructive">{preparing.failed}</p>}
        </motion.div>
      )}

      <motion.ul variants={riseChild} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {slides.map((slide) => (
          <li key={slide.id}>
            <SlideCard
              presentationId={id}
              slide={slide}
              ready={slide.cached || preparing.ready.has(slide.id)}
              onPresent={() => present(slide.id)}
            />
          </li>
        ))}
      </motion.ul>
      {slides.length === 0 && <p className="text-sm text-muted-foreground">The deck has no slides.</p>}

      {renaming && <RenameDialog id={id} name={name} onClose={() => setRenaming(false)} />}
      {player}
    </motion.div>
  );
}

function SlideCard({
  presentationId,
  slide,
  ready,
  onPresent,
}: {
  presentationId: string;
  slide: PresentationSlide;
  ready: boolean;
  onPresent: () => void;
}) {
  return (
    <button
      type="button"
      disabled={slide.skipped}
      onClick={onPresent}
      aria-label={slide.skipped ? `Slide ${slide.number}, skipped` : `Present from slide ${slide.number}`}
      className="group block w-full text-left disabled:cursor-default"
    >
      <div
        className={cn(
          "relative aspect-video overflow-hidden rounded-lg border bg-muted transition-shadow group-enabled:group-hover:ring-2 group-enabled:group-hover:ring-brand/60",
          slide.skipped && "opacity-40",
        )}
      >
        {ready ? (
          // eslint-disable-next-line @next/next/no-img-element -- a slide picture, served by the app's own route
          <img src={slideImageUrl(presentationId, slide)} alt="" loading="lazy" className="size-full object-contain" />
        ) : (
          <LoaderCircle className="absolute inset-0 m-auto size-5 animate-spin text-muted-foreground" />
        )}
      </div>
      <p className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">{slide.number}</span>
        {slide.skipped && <span>Skipped</span>}
        {!slide.skipped && slide.notes && <NotebookText className="size-3.5" aria-label="Has speaker notes" />}
      </p>
    </button>
  );
}

/**
 * Fetches, one at a time, every slide picture not yet here: presented slides
 * first, then skipped ones. The server paces its calls to Google, so this only
 * keeps one request open at a time.
 */
function usePrepare(presentationId: string, slides: PresentationSlide[]) {
  const [ready, setReady] = useState<Set<string>>(() => new Set());
  const [failed, setFailed] = useState<string | null>(null);
  const wanted = [...slides].filter((s) => !s.cached).sort((a, b) => Number(a.skipped) - Number(b.skipped));
  const key = wanted.map((s) => `${s.id}:${s.version}`).join(",");

  useEffect(() => {
    let stopped = false;
    void (async () => {
      for (const slide of wanted) {
        if (stopped) return;
        const res = await fetch(slideImageUrl(presentationId, slide)).catch(() => null);
        if (stopped) return;
        if (!res?.ok) {
          const body = await res?.json().catch(() => null);
          setFailed(body?.message ?? "Some slides could not be fetched from Google.");
          return;
        }
        setReady((r) => new Set(r).add(slide.id));
      }
    })();
    return () => {
      stopped = true;
    };
    // `key` stands for `wanted`: the loop starts again only when the slides to fetch change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentationId, key]);

  const done = wanted.filter((s) => ready.has(s.id)).length;
  return { ready, done, left: failed ? 0 : wanted.length - done, failed };
}
