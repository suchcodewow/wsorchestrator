"use client";

/**
 * A presentation in the order it is shown: the deck's slides with the
 * presentation's own pages among them. A click on one presents from it; an
 * administrator inserts a page before any slide, or at the end. Slides whose
 * pictures are not here yet are fetched from Google one at a time while the
 * page is open, so presenting later shows each at once.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ExternalLink,
  LoaderCircle,
  MoreHorizontal,
  NotebookText,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  SquarePlus,
  Trash2,
} from "lucide-react";
import { PageView } from "@/components/presentations/page-view";
import { usePresenter } from "@/components/presentations/player";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { riseChild, staggerParent } from "@/lib/motion";
import { presentedSlides, showItems, slideImageUrl, type LivePage } from "@/lib/presentations/live";
import type { Presentation, PresentationSlide } from "@/lib/presentations/presentations";
import { cn } from "@/lib/utils";
import { formatSynced } from "../format";
import { RenameDialog } from "./rename-dialog";

export function PresentationView({ presentation, canManage }: { presentation: Presentation; canManage: boolean }) {
  const router = useRouter();
  const { id, name, slides, pages } = presentation;
  const show = useMemo(() => ({ slides, pages }), [slides, pages]);
  const order = useMemo(() => showItems(slides, pages, true), [slides, pages]);
  const { present, player } = usePresenter(id, show);
  const shown = presentedSlides(slides);
  const preparing = usePrepare(id, slides);
  const [syncing, setSyncing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [renaming, setRenaming] = useState(false);

  async function addPage(before: string | null) {
    setAdding(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/presentations/${id}/pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ before }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage({
          text:
            body?.error === "too_many_pages"
              ? "This presentation has as many pages as it can hold."
              : `Could not add a page (${res.status}).`,
          error: true,
        });
        return;
      }
      router.push(`/presentations/${id}/pages/${body.id}`);
    } catch {
      setMessage({ text: "Could not reach the server.", error: true });
    } finally {
      setAdding(false);
    }
  }

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
            {shown.length !== slides.length && ` and ${slides.length - shown.length} skipped`}
            {pages.length > 0 && ` · ${pages.length} ${pages.length === 1 ? "page" : "pages"} of its own`} · read from Google{" "}
            {formatSynced(presentation.syncedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="brand" disabled={shown.length + pages.length === 0} onClick={() => present()}>
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
        {order.map((item) => (
          <li key={item.id}>
            {item.kind === "slide" ? (
              <SlideCard
                presentationId={id}
                slide={item.slide}
                ready={item.slide.cached || preparing.ready.has(item.slide.id)}
                onPresent={() => present(item.id)}
                onInsert={canManage && !adding ? () => void addPage(item.slide.googlePageId) : undefined}
              />
            ) : (
              <PageCard
                page={item.page}
                editHref={canManage ? `/presentations/${id}/pages/${item.id}` : undefined}
                onPresent={() => present(item.id)}
              />
            )}
          </li>
        ))}
        {canManage && (
          <li>
            <button
              type="button"
              disabled={adding}
              onClick={() => void addPage(null)}
              className="grid aspect-video w-full place-items-center rounded-lg border border-dashed text-sm text-muted-foreground transition-colors hover:border-brand/60 hover:text-foreground"
            >
              <span className="inline-flex items-center gap-1.5">
                <SquarePlus className="size-4" />
                Add page
              </span>
            </button>
          </li>
        )}
      </motion.ul>

      {renaming && <RenameDialog id={id} name={name} onClose={() => setRenaming(false)} />}
      {player}
    </motion.div>
  );
}

const THUMB = "relative aspect-video overflow-hidden rounded-lg border bg-muted transition-shadow";
const THUMB_HOVER = "group-enabled:group-hover:ring-2 group-enabled:group-hover:ring-brand/60";

function SlideCard({
  presentationId,
  slide,
  ready,
  onPresent,
  onInsert,
}: {
  presentationId: string;
  slide: PresentationSlide;
  ready: boolean;
  onPresent: () => void;
  /** Puts a new page just before this slide; only for administrators. */
  onInsert?: () => void;
}) {
  return (
    <div>
      <button
        type="button"
        disabled={slide.skipped}
        onClick={onPresent}
        aria-label={slide.skipped ? `Slide ${slide.number}, skipped` : `Present from slide ${slide.number}`}
        className="group block w-full text-left disabled:cursor-default"
      >
        <div className={cn(THUMB, THUMB_HOVER, slide.skipped && "opacity-40")}>
          {ready ? (
            // eslint-disable-next-line @next/next/no-img-element -- a slide picture, served by the app's own route
            <img src={slideImageUrl(presentationId, slide)} alt="" loading="lazy" className="size-full object-contain" />
          ) : (
            <LoaderCircle className="absolute inset-0 m-auto size-5 animate-spin text-muted-foreground" />
          )}
        </div>
      </button>
      <div className="mt-1 flex h-7 items-center gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">{slide.number}</span>
        {slide.skipped && <span>Skipped</span>}
        {!slide.skipped && slide.notes && <NotebookText className="size-3.5" aria-label="Has speaker notes" />}
        {onInsert && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2 text-xs"
            onClick={onInsert}
            aria-label={`Insert a page before slide ${slide.number}`}
          >
            <Plus />
            Insert page
          </Button>
        )}
      </div>
    </div>
  );
}

function PageCard({ page, editHref, onPresent }: { page: LivePage; editHref?: string; onPresent: () => void }) {
  return (
    <div>
      <button type="button" onClick={onPresent} aria-label="Present from this page" className="group block w-full text-left">
        <div className={cn(THUMB, THUMB_HOVER, "border-brand/40")}>
          <PageView document={page.document} state="all" />
        </div>
      </button>
      <div className="mt-1 flex h-7 items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-brand">Page</span>
        {page.notes && <NotebookText className="size-3.5" aria-label="Has speaker notes" />}
        {editHref && (
          <Button variant="ghost" size="sm" className="ml-auto h-7 px-2 text-xs" asChild>
            <Link href={editHref}>
              <Pencil />
              Edit
            </Link>
          </Button>
        )}
      </div>
    </div>
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
