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
  Sparkles,
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

const CONVERT_ERRORS: Record<string, string> = {
  not_found: "That slide is no longer in the deck. Refresh from Google.",
  skipped: "A skipped slide is not presented, so there is nothing to convert.",
  too_many_pages: "This presentation has as many pages as it can hold.",
};

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
  const [converting, setConverting] = useState<string | null>(null);
  const slideReplacedBy = (page: LivePage) => (page.replaces ? slides.find((s) => s.googlePageId === page.replaces) : undefined);

  /** Converts a slide into a page that stands in for it, then opens that page to edit. */
  async function convert(slideId: string) {
    setConverting(slideId);
    setMessage(null);
    try {
      const res = await fetch(`/api/presentations/${id}/slides/${slideId}/convert`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage({ text: body?.message ?? CONVERT_ERRORS[body?.error ?? ""] ?? `Could not convert it (${res.status}).`, error: true });
        return;
      }
      router.push(`/presentations/${id}/pages/${body.pageId}`);
    } catch {
      setMessage({ text: "Could not reach the server.", error: true });
    } finally {
      setConverting(null);
    }
  }

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
                converting={converting === item.slide.id}
                onPresent={() => present(item.id)}
                onInsert={canManage && !adding ? () => void addPage(item.slide.googlePageId) : undefined}
                onConvert={canManage && !converting && !item.slide.skipped ? () => void convert(item.slide.id) : undefined}
              />
            ) : (
              <PageCard
                presentationId={id}
                page={item.page}
                converting={converting !== null && converting === slideReplacedBy(item.page)?.id}
                editHref={canManage ? `/presentations/${id}/pages/${item.id}` : undefined}
                onPresent={() => present(item.id)}
                onConvertAgain={
                  canManage && !converting && item.page.stale && slideReplacedBy(item.page)
                    ? () => void convert(slideReplacedBy(item.page)!.id)
                    : undefined
                }
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

/** Over a card while Google draws the pictures its conversion needs. */
function Converting() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-background/70 text-xs text-foreground backdrop-blur-[1px]">
      <span className="inline-flex items-center gap-1.5">
        <LoaderCircle className="size-4 animate-spin" />
        Converting…
      </span>
    </div>
  );
}

function SlideCard({
  presentationId,
  slide,
  ready,
  converting,
  onPresent,
  onInsert,
  onConvert,
}: {
  presentationId: string;
  slide: PresentationSlide;
  ready: boolean;
  converting: boolean;
  onPresent: () => void;
  /** Puts a new page just before this slide; only for administrators. */
  onInsert?: () => void;
  /** Turns this slide into a page that stands in for it; only for administrators. */
  onConvert?: () => void;
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
          {converting && <Converting />}
        </div>
      </button>
      <div className="mt-1 flex h-7 items-center gap-1 text-xs text-muted-foreground">
        <span className="mr-1 tabular-nums">{slide.number}</span>
        {slide.skipped && <span>Skipped</span>}
        {!slide.skipped && slide.notes && <NotebookText className="size-3.5" aria-label="Has speaker notes" />}
        <span className="ml-auto" />
        {onConvert && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onConvert}
            aria-label={`Make slide ${slide.number} dynamic`}
          >
            <Sparkles />
            Make dynamic
          </Button>
        )}
        {onInsert && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
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

function PageCard({
  presentationId,
  page,
  converting,
  editHref,
  onPresent,
  onConvertAgain,
}: {
  presentationId: string;
  page: LivePage;
  converting: boolean;
  editHref?: string;
  onPresent: () => void;
  /** For a converted page whose slide changed in Google since: converts it afresh. */
  onConvertAgain?: () => void;
}) {
  return (
    <div>
      <button type="button" onClick={onPresent} aria-label="Present from this page" className="group block w-full text-left">
        <div className={cn(THUMB, THUMB_HOVER, "border-brand/40")}>
          <PageView presentationId={presentationId} document={page.document} state="all" />
          {converting && <Converting />}
        </div>
      </button>
      <div className="mt-1 flex h-7 items-center gap-1 text-xs text-muted-foreground">
        <span className="mr-1 font-medium text-brand">{page.replaces ? "Dynamic slide" : "Page"}</span>
        {page.notes && <NotebookText className="size-3.5" aria-label="Has speaker notes" />}
        {page.stale && <span className="text-amber-600 dark:text-amber-400">Changed in Google</span>}
        <span className="ml-auto" />
        {onConvertAgain && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onConvertAgain}>
            <RefreshCw />
            Convert again
          </Button>
        )}
        {editHref && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" asChild>
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
