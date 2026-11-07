"use client";

/**
 * The feedback buttons above a Diagnostic question: the same green smiley and
 * orange confused faces as on every video, each with a comment button tucked
 * behind it. A face saves its rating the moment it is pressed; a comment
 * button opens a small box, and saving it saves that rating with the words.
 * The sitting and the question's number go with it, and the server files it
 * against the question on screen, for Diagnostic Settings → Feedback.
 *
 * Drawn after the slide review's `SlideFeedback`: that one is filed by a
 * slide's seed, and a question here is named only by the server.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader2, MessageSquarePlus } from "lucide-react";
import { RATING_LABELS, RATING_TEXT_TONES, RatingFace } from "@/components/rating-face";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { VIDEO_FEEDBACK_LIMITS, type VideoFeedbackRating } from "@/db/schema";
import { anchorFloating } from "@/lib/floating";
import { cn } from "@/lib/utils";

/** How long a saved rating stays lit. */
const SAVED_MS = 2_000;

/** The question rated: its sitting and the sitting's number for it. */
type On = { attemptId: string; number: number };

const ERRORS: Record<string, string> = {
  finished: "This sitting is already over.",
  stale: "That question has moved on. Reload to rate the one on screen.",
};

async function sendFeedback(on: On, rating: VideoFeedbackRating, comment?: string) {
  try {
    const res = await fetch("/api/diagnostic/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...on, rating, comment }),
    });
    if (res.ok) return null;
    const body = await res.json().catch(() => null);
    return ERRORS[body?.error] ?? `Couldn't save it (${res.status}).`;
  } catch {
    return "Could not reach the server.";
  }
}

/** Keyed by the question by its caller, so a new question starts with the box closed. */
export function QuestionFeedback({ attemptId, number }: On) {
  const [sending, setSending] = useState<VideoFeedbackRating | null>(null);
  const [saved, setSaved] = useState<VideoFeedbackRating | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState<{ rating: VideoFeedbackRating; anchor: HTMLElement } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function flash(rating: VideoFeedbackRating) {
    setSaved(rating);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(null), SAVED_MS);
  }

  async function rate(rating: VideoFeedbackRating) {
    setSending(rating);
    setError(null);
    const failed = await sendFeedback({ attemptId, number }, rating);
    setSending(null);
    if (failed) setError(failed);
    else flash(rating);
  }

  return (
    <TooltipProvider>
      <div data-question-feedback className="relative flex items-center gap-2">
        {(error || saved) && (
          <span role="status" className={cn("text-xs text-muted-foreground", error && "text-destructive")}>
            {error ?? "Thanks for the feedback!"}
          </span>
        )}
        <div className="flex items-center gap-4">
          {(["up", "down"] as const).map((rating) => {
            const tone = rating === "up" ? "bg-green-600 hover:bg-green-500" : "bg-orange-500 hover:bg-orange-400";
            return (
              <div key={rating} className="flex items-center">
                <FaceButton
                  label={RATING_LABELS[rating]}
                  disabled={sending === rating}
                  active={saved === rating}
                  className={cn("relative z-10 size-9 rounded-full shadow-md ring-2 ring-background", tone)}
                  onClick={() => void rate(rating)}
                >
                  {sending === rating ? <Loader2 className="animate-spin" /> : <RatingFace rating={rating} />}
                </FaceButton>
                <FaceButton
                  label={`${RATING_LABELS[rating]}, with a comment`}
                  active={composing?.rating === rating}
                  className={cn("-ml-3 h-7 w-10 rounded-md pl-3 brightness-90", tone)}
                  onClick={(e) => {
                    setError(null);
                    setComposing({ rating, anchor: e.currentTarget });
                  }}
                >
                  <MessageSquarePlus />
                </FaceButton>
              </div>
            );
          })}
        </div>
        {composing && (
          <CommentBox
            key={`${composing.rating}-${number}`}
            on={{ attemptId, number }}
            rating={composing.rating}
            anchor={composing.anchor}
            onClose={(savedRating) => {
              setComposing(null);
              if (savedRating) flash(savedRating);
            }}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

function FaceButton({
  label,
  active,
  disabled,
  className,
  onClick,
  children,
}: {
  label: string;
  className?: string;
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
            "inline-flex cursor-pointer items-center justify-center text-white outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default [&_svg]:size-4",
            active && "brightness-125",
            className,
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
 * The comment box, beside the button that opened it. The sitting's answer
 * keys ignore anything typed inside `data-question-feedback`, so a letter or
 * Enter here writes the comment rather than answering; Escape cancels it.
 */
function CommentBox({
  on,
  rating,
  anchor,
  onClose,
}: {
  on: On;
  rating: VideoFeedbackRating;
  anchor: HTMLElement;
  onClose: (saved: VideoFeedbackRating | null) => void;
}) {
  const box = useRef<HTMLFormElement>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!box.current) return;
    return anchorFloating(anchor, box.current, { strategy: "absolute", placement: "bottom-end" });
  }, [anchor]);

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
    const failed = await sendFeedback(on, rating, text);
    setSaving(false);
    if (failed) setError(failed);
    else onClose(rating);
  }

  return (
    <form
      ref={box}
      role="dialog"
      aria-label={`${RATING_LABELS[rating]} comment`}
      className="absolute top-0 left-0 z-20 w-72 space-y-2 rounded-xl border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="flex items-center gap-1.5 font-medium">
        <RatingFace rating={rating} className={cn("size-3.5", RATING_TEXT_TONES[rating])} />
        {RATING_LABELS[rating]} on question <span className="tnum">{on.number}</span>
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
