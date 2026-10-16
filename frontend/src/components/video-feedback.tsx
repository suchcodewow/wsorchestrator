"use client";

/**
 * A video with feedback buttons over its top corner: a thumbs up and a thumbs
 * down, each with a comment button beside it. A thumb is saved the moment it
 * is pressed, with where the video was. A comment button pauses the video and
 * opens a small box beside it; saving the comment saves that thumb with it,
 * closes the box and plays on. Cancelling saves nothing and plays on too.
 * Every player in the app is one of these, so feedback works the same
 * everywhere.
 *
 * The buttons sit over the player rather than in the browser's own controls,
 * and the browser's full screen would show the video alone, so it is turned
 * off: the button is greyed out and a double-click does nothing. A video plays
 * in `VideoPlayerDialog`, which fills the window instead. Chrome and Edge
 * honour that; Firefox and Safari still offer their full-screen button.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type RefObject } from "react";
import { Loader2, MessageSquarePlus, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { VIDEO_FEEDBACK_LIMITS, type VideoFeedbackKind, type VideoFeedbackRating } from "@/db/schema";
import { anchorFloating } from "@/lib/floating";
import { formatDuration } from "@/lib/recording/format";
import { cn } from "@/lib/utils";

/** The video feedback is filed against: a Mimir concept's id, or a recording stream's. */
export type FeedbackTarget = { kind: VideoFeedbackKind; id: string };

/** How long a saved thumb stays lit. */
const SAVED_MS = 2_000;

const RATING_LABELS: Record<VideoFeedbackRating, string> = { up: "Thumbs up", down: "Thumbs down" };

type Composing = { rating: VideoFeedbackRating; position: number; resume: boolean; anchor: HTMLElement };

async function sendFeedback(target: FeedbackTarget, rating: VideoFeedbackRating, position: number, comment?: string) {
  try {
    const res = await fetch("/api/video-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video: target, rating, position, comment }),
    });
    return res.ok ? null : `Couldn't save it (${res.status}).`;
  } catch {
    return "Could not reach the server.";
  }
}

export function VideoWithFeedback({
  feedback,
  videoRef,
  wrapperClassName,
  controlsList,
  onDoubleClick,
  ...props
}: ComponentProps<"video"> & {
  feedback: FeedbackTarget;
  /** The caller's own handle on the element, when it needs one. */
  videoRef?: RefObject<HTMLVideoElement | null>;
  wrapperClassName?: string;
}) {
  const own = useRef<HTMLVideoElement>(null);
  const video = videoRef ?? own;
  return (
    <div className={cn("relative", wrapperClassName)}>
      <video
        ref={video}
        controlsList={["nofullscreen", controlsList].filter(Boolean).join(" ")}
        onDoubleClick={(e) => {
          e.preventDefault();
          onDoubleClick?.(e);
        }}
        {...props}
      />
      <FeedbackBar video={video} target={feedback} />
    </div>
  );
}

function FeedbackBar({ video, target }: { video: RefObject<HTMLVideoElement | null>; target: FeedbackTarget }) {
  const [sending, setSending] = useState<VideoFeedbackRating | null>(null);
  const [saved, setSaved] = useState<VideoFeedbackRating | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState<Composing | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function flash(rating: VideoFeedbackRating) {
    setSaved(rating);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(null), SAVED_MS);
  }

  async function thumb(rating: VideoFeedbackRating) {
    const el = video.current;
    if (!el) return;
    setSending(rating);
    setError(null);
    const failed = await sendFeedback(target, rating, el.currentTime);
    setSending(null);
    if (failed) setError(failed);
    else flash(rating);
  }

  function comment(rating: VideoFeedbackRating, anchor: HTMLElement) {
    const el = video.current;
    if (!el) return;
    const resume = !el.paused && !el.ended;
    el.pause();
    setError(null);
    setComposing({ rating, position: el.currentTime, resume, anchor });
  }

  function close(savedRating: VideoFeedbackRating | null) {
    const resume = composing?.resume;
    setComposing(null);
    if (savedRating) flash(savedRating);
    if (resume) void video.current?.play().catch(() => undefined);
  }

  return (
    <TooltipProvider>
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        {(error || saved) && (
          <span
            role="status"
            className={cn("rounded-full bg-black/65 px-2.5 py-1 text-xs text-white", error && "text-red-300")}
          >
            {error ?? "Thanks for the feedback!"}
          </span>
        )}
        <div className="flex items-center gap-0.5 rounded-full bg-black/55 p-1 text-white backdrop-blur-sm">
          {(["up", "down"] as const).map((rating, i) => (
            <div key={rating} className="flex items-center gap-0.5">
              {i > 0 && <span aria-hidden className="mx-1 h-5 w-px bg-white/25" />}
              <OverlayButton
                label={RATING_LABELS[rating]}
                disabled={sending === rating}
                active={saved === rating}
                onClick={() => void thumb(rating)}
              >
                {sending === rating ? (
                  <Loader2 className="animate-spin" />
                ) : rating === "up" ? (
                  <ThumbsUp className={cn(saved === "up" && "fill-current")} />
                ) : (
                  <ThumbsDown className={cn(saved === "down" && "fill-current")} />
                )}
              </OverlayButton>
              <OverlayButton
                label={`${RATING_LABELS[rating]}, with a comment`}
                active={composing?.rating === rating}
                onClick={(e) => comment(rating, e.currentTarget)}
              >
                <MessageSquarePlus />
              </OverlayButton>
            </div>
          ))}
        </div>
      </div>
      {composing && <CommentBox key={`${composing.rating}-${composing.position}`} target={target} composing={composing} onClose={close} />}
    </TooltipProvider>
  );
}

function OverlayButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            "inline-flex size-8 cursor-pointer items-center justify-center rounded-full outline-none transition-colors hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-default [&_svg]:size-4",
            active && "bg-white/20",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The comment box, beside the button that opened it. It stays inside the
 * player's box in the DOM, so a dialog the player is in still counts it as
 * inside. Escape cancels it without closing that dialog as well.
 */
function CommentBox({
  target,
  composing,
  onClose,
}: {
  target: FeedbackTarget;
  composing: Composing;
  onClose: (saved: VideoFeedbackRating | null) => void;
}) {
  const box = useRef<HTMLFormElement>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!box.current) return;
    return anchorFloating(composing.anchor, box.current, { strategy: "absolute", placement: "bottom-end" });
  }, [composing.anchor]);

  // Radix's Dialog hears Escape on the document, in the capture phase; the
  // window hears it first, so stopping it here keeps the dialog open.
  const latestClose = useRef(onClose);
  useEffect(() => {
    latestClose.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      latestClose.current(null);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  async function save() {
    if (!text.trim() || saving) return;
    setSaving(true);
    setError(null);
    const failed = await sendFeedback(target, composing.rating, composing.position, text);
    setSaving(false);
    if (failed) setError(failed);
    else onClose(composing.rating);
  }

  const Icon = composing.rating === "up" ? ThumbsUp : ThumbsDown;
  return (
    <form
      ref={box}
      role="dialog"
      aria-label={`${RATING_LABELS[composing.rating]} comment`}
      className="absolute top-0 left-0 z-20 w-72 space-y-2 rounded-xl border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="flex items-center gap-1.5 font-medium">
        <Icon className="size-3.5" />
        {RATING_LABELS[composing.rating]} at <span className="tabular-nums">{formatDuration(composing.position * 1000)}</span>
      </p>
      <Textarea
        autoFocus
        value={text}
        maxLength={VIDEO_FEEDBACK_LIMITS.comment}
        placeholder="What made you say so?"
        aria-label="Comment"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => onClose(null)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!text.trim() || saving}>
          {saving && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </div>
    </form>
  );
}
