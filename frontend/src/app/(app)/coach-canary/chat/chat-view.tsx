"use client";

/**
 * The coach. Opening the tab, it greets you by saying how far through the
 * course you are and asking what you know of the next concept; your answers
 * move you on, or send you to the video. Your message shows at once and the
 * coach's reply streams in as it is written. The next concept's main points
 * show as a checklist above the conversation, each ticked once you have said
 * it in your own words, so you are never asked to repeat the lot. When the
 * coach ticks a point, marks a concept mastered, or recommends its video, it
 * says so under its reply and the map follows. A long conversation shows its latest turns, with the earlier ones
 * a click away. The map's chat button opens the tab with ?ask=<concept>: that
 * asks the coach to switch to the concept, in place of a greeting, and the
 * parameter comes off the address.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronUp, Circle, CircleCheck, Loader2, Play, RotateCcw, SendHorizontal, Star, Check } from "lucide-react";
import { CoachCanaryAvatar } from "@/components/coach-canary-art";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import {
  MIMIR_COACH_NAMES,
  MIMIR_COACH_PERSONALITIES,
  MIMIR_COACH_STYLES,
  MIMIR_MESSAGE_MAX,
  MIMIR_REP_ROLES,
  type MimirCoachPersonality,
  type MimirCoachStyle,
  type MimirMessageRole,
  type MimirRepRole,
} from "@/db/schema";
import { cn } from "@/lib/utils";
import { confirmDialog } from "@/components/ui/confirm";

type Msg = { seq: number; role: MimirMessageRole; text: string; html: string | null; at: string };
type Point = { text: string; covered: boolean };
type Progress = { mastered: number; total: number; next: { id: string; name: string; hasVideo: boolean; points: Point[] | null } | null };
type View = {
  configured: boolean;
  conversation: { messages: Msg[]; earlier: boolean } | null;
  needsGreeting: boolean;
  progress: Progress;
};
type Concept = { id: string; name: string; hasVideo: boolean };
type Covered = { id: string; points: string[]; covered: number; total: number };
type Done = { messages: Msg[]; progress: Progress; mastered: string[]; recommended: string[]; covered: Covered[] };

const ERRORS: Record<string, string> = {
  busy: "The coach is still answering your last message.",
  full: "This conversation is as long as the coach can read. Start a new one to keep going; your progress stays.",
  refused: "The coach declined to answer that. Try putting it another way.",
  upstream: "The coach couldn't be reached. Try again in a moment.",
  not_configured: "The coach isn't set up on this server yet.",
  no_map: "There is no course to coach on yet.",
  impersonating: "You're viewing the app as someone else, so you can't send messages.",
};

/** Reads a server-sent event stream, handing each event to `on`. */
async function readEvents(res: Response, on: (event: string, data: unknown) => void) {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let end = buffer.indexOf("\n\n");
    while (end >= 0) {
      const chunk = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = /^event: (.*)$/m.exec(chunk)?.[1] ?? "message";
      const data = /^data: (.*)$/m.exec(chunk)?.[1];
      if (data !== undefined) on(event, JSON.parse(data));
      end = buffer.indexOf("\n\n");
    }
  }
}

/** Asking to switch to the concept picked on the map, when there is one; otherwise a greeting, when the coach is due to speak. */
function openingFor(asked: Concept | undefined, needsGreeting: boolean): { message: string; focus: string } | { open: true } | null {
  if (asked) return { message: `Can we switch to ${asked.name}?`, focus: asked.id };
  return needsGreeting ? { open: true } : null;
}

type Notice = { kind: "mastered" | "recommended"; id: string } | ({ kind: "covered" } & Covered);

export function ChatView({
  initial,
  concepts,
  profile,
  canSeePoints,
}: {
  initial: View;
  concepts: Concept[];
  profile: Profile;
  /** Assessments Administrators alone see the next concept's points covered. */
  canSeePoints: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [view, setView] = useState(initial);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [replying, setReplying] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<Record<number, Notice[]>>({});
  const [prefs, setPrefs] = useState(profile);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const greeted = useRef(false);
  // What the coach is sent on opening the tab, read once, before the parameter comes off the address.
  const opening = useRef(openingFor(concepts.find((c) => c.id === params.get("ask")), initial.needsGreeting));
  const busy = replying || resetting;
  const nameOf = (id: string) => concepts.find((c) => c.id === id)?.name ?? id;

  const messages = view.conversation?.messages ?? [];
  useEffect(() => {
    if (stick.current) scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages.length, pending, streaming, replying]);

  /** One turn: what you said, or a greeting, and the coach's reply as it is written. */
  async function run(input: { message: string; focus?: string } | { open: true }) {
    stick.current = true;
    if ("message" in input) setPending(input.message);
    setReplying(true);
    setStreaming("");
    setError(null);
    let done: Done | null = null;
    let failed: string | null = null;
    try {
      const res = await fetch("/api/mimir/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(input),
      });
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
        const body = await res.json().catch(() => null);
        failed = ERRORS[body?.error ?? ""] ?? `Something went wrong (${res.status}).`;
      } else {
        await readEvents(res, (event, data) => {
          const d = data as { delta?: string; error?: string; status?: number } & Partial<Done>;
          if (event === "text") setStreaming((s) => s + (d.delta ?? ""));
          else if (event === "restart") setStreaming("");
          else if (event === "done") done = d as Done;
          else if (event === "error") failed = ERRORS[d.error ?? ""] ?? `Something went wrong (${d.status ?? "?"}).`;
        });
        if (!done && !failed) failed = "The reply was cut off. Reload to see whether it was saved.";
      }
    } catch {
      failed = "Could not reach the server.";
    }

    if (done) {
      const result: Done = done;
      const reply = result.messages.at(-1);
      setView((v) => ({
        ...v,
        needsGreeting: false,
        conversation: { earlier: v.conversation?.earlier ?? false, messages: [...(v.conversation?.messages ?? []), ...result.messages] },
        progress: result.progress,
      }));
      const made: Notice[] = [
        // A concept the reply finished says so once, as mastered, rather than as its last point too.
        ...(result.covered ?? []).filter((c) => !result.mastered.includes(c.id)).map((c) => ({ kind: "covered" as const, ...c })),
        ...result.mastered.map((id) => ({ kind: "mastered" as const, id })),
        ...result.recommended.map((id) => ({ kind: "recommended" as const, id })),
      ];
      if (reply && made.length) setNotices((n) => ({ ...n, [reply.seq]: made }));
      router.refresh();
    } else {
      setError(failed);
      if ("message" in input) setDraft((d) => d || input.message);
    }
    setPending(null);
    setReplying(false);
    setStreaming("");
  }

  // Opening the tab from a concept's chat button on the map: you ask the coach to switch to it, which stands in for a greeting.
  // Otherwise, with the coach due to speak: it greets you, says where you are, and asks about the next concept.
  useEffect(() => {
    if (greeted.current || !opening.current || !initial.configured) return;
    greeted.current = true;
    void run(opening.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (params.has("ask")) router.replace("/coach-canary/chat", { scroll: false });
  }, [params, router]);

  async function send() {
    const message = draft.trim();
    if (!message || busy) return;
    setDraft("");
    await run({ message });
  }

  async function loadEarlier() {
    const first = messages[0];
    if (!first) return;
    setLoadingEarlier(true);
    stick.current = false;
    try {
      const page = (await fetch(`/api/mimir/coach?before=${first.seq}`).then((r) => r.json())) as View;
      const older = page.conversation;
      if (older) {
        setView((v) => ({ ...v, conversation: v.conversation && { earlier: older.earlier, messages: [...older.messages, ...v.conversation.messages] } }));
      }
    } finally {
      setLoadingEarlier(false);
    }
  }

  async function resetMemory() {
    if (!(await confirmDialog({ title: "Reset chat memory?", description: "The coach forgets this conversation and it is deleted; your progress, mastery and videos watched stay.", confirmLabel: "Reset", destructive: true }))) return;
    setResetting(true);
    setError(null);
    try {
      const res = await fetch("/api/mimir/coach", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(ERRORS[body?.error ?? ""] ?? `Could not reset chat memory (${res.status}).`);
        return;
      }
      setNotices({});
      setView((v) => ({ ...v, conversation: null }));
      greeted.current = true;
      await run({ open: true });
    } catch {
      setError("Could not reach the server.");
    } finally {
      setResetting(false);
    }
  }

  async function savePrefs(next: Profile) {
    setPrefs(next);
    setPrefsError(null);
    try {
      const res = await fetch("/api/mimir/me", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      if (!res.ok) setPrefsError(res.status === 403 ? "You can't change this while viewing as someone else." : `Could not save (${res.status}).`);
    } catch {
      setPrefsError("Could not reach the server.");
    }
  }

  const next = view.progress.next;
  const pct = view.progress.total ? Math.round((view.progress.mastered / view.progress.total) * 100) : 0;

  return (
    <section className="mx-auto flex max-h-[calc(100dvh-19rem)] min-h-[32rem] max-w-3xl flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
      <header className="space-y-3 border-b px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CoachCanaryAvatar className="size-7" />
            <span className="font-medium">Coach style:</span>
            <PersonalityMenu value={prefs.coachPersonality} onChoose={(coachPersonality) => void savePrefs({ ...prefs, coachPersonality })} />
          </div>
          <CoachOptions
            profile={prefs}
            error={prefsError}
            onSave={(next) => void savePrefs(next)}
            onReset={view.conversation ? () => void resetMemory() : null}
            resetting={resetting}
            disabled={busy}
          />
        </div>
        <div className="space-y-1.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={view.progress.total} aria-valuenow={view.progress.mastered} aria-label="Concepts mastered">
            <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="tnum">
              {view.progress.mastered} of {view.progress.total} mastered
            </span>
            {next ? (
              <span className="flex items-center gap-2">
                Next: <span className="font-medium text-foreground">{next.name}</span>
                <Link href={next.hasVideo ? `/coach-canary/map?play=${encodeURIComponent(next.id)}` : "/coach-canary/map"} className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
                  <Play className="size-3 fill-current" />
                  {next.hasVideo ? "Play video" : "Open the map"}
                </Link>
              </span>
            ) : (
              <span className="font-medium text-foreground">Every concept mastered</span>
            )}
          </div>
          {canSeePoints && next?.points && <Checklist points={next.points} />}
        </div>
      </header>

      <div
        ref={scroller}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        onClick={(e) => {
          // A link the coach wrote to somewhere in the app moves there without reloading.
          const a = (e.target as HTMLElement).closest("a");
          const href = a?.getAttribute("href");
          if (a && href?.startsWith("/") && !href.startsWith("//") && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
            e.preventDefault();
            router.push(href);
          }
        }}
      >
        {view.conversation?.earlier && (
          <div className="flex justify-center">
            <Button variant="ghost" size="sm" disabled={loadingEarlier} onClick={() => void loadEarlier()}>
              {loadingEarlier ? <Loader2 className="animate-spin" /> : <ChevronUp />}
              Earlier messages
            </Button>
          </div>
        )}
        {messages.length === 0 && !replying && (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">
            {view.configured ? "The coach will say hello in a moment." : "The coach isn't set up on this server yet."}
          </p>
        )}
        {messages.map((m) => (
          <div key={m.seq} className="space-y-1.5">
            <Bubble role={m.role} html={m.html} text={m.text} />
            {notices[m.seq]?.map((n) =>
              n.kind === "covered" ? (
                <p key={`${n.kind}${n.id}`} className="flex items-start gap-1.5 px-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  <CircleCheck className="mt-px size-3.5 shrink-0" />
                  <span>
                    {nameOf(n.id)}: {n.points.join("; ")}
                    <span className="tnum font-normal text-muted-foreground">
                      {" "}
                      ({n.covered} of {n.total})
                    </span>
                  </span>
                </p>
              ) : (
                <p key={`${n.kind}${n.id}`} className={cn("flex items-center gap-1.5 px-1 text-xs font-medium", n.kind === "mastered" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>
                  {n.kind === "mastered" ? <Check className="size-3.5" strokeWidth={3} /> : <Star className="size-3.5 fill-current" />}
                  {n.kind === "mastered" ? `${nameOf(n.id)} marked as mastered.` : `${nameOf(n.id)} flagged as Recommended on the map.`}
                </p>
              ),
            )}
          </div>
        ))}
        {pending && <Bubble role="user" html={null} text={pending} />}
        {replying &&
          (streaming ? (
            <Bubble role="assistant" html={null} text={streaming.replace(/\[(?:MASTERED|RECOMMEND|POINTS|COVERED):[^\]]*\]?/gi, "").trimEnd()} live />
          ) : (
            <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              The coach is thinking…
            </div>
          ))}
      </div>

      <footer className="space-y-2 border-t px-4 py-3">
        {(error ?? prefsError) && (
          <p role="alert" className="text-sm text-destructive">
            {error ?? prefsError}
          </p>
        )}
        {!view.configured ? (
          <p className="text-sm text-muted-foreground">The coach isn&apos;t set up on this server yet.</p>
        ) : (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              maxLength={MIMIR_MESSAGE_MAX}
              rows={2}
              placeholder="Your answer… (Enter to send, Shift+Enter for a new line)"
              aria-label="Your message to the coach"
              className="max-h-40 min-h-0 resize-none"
              aria-busy={busy}
            />
            <Button type="submit" variant="brand" size="icon" aria-label="Send" disabled={!draft.trim() || busy}>
              {replying ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
            </Button>
          </form>
        )}
      </footer>
    </section>
  );
}

/** The next concept's main points, each ticked once you have put it in your own words. */
function Checklist({ points }: { points: Point[] }) {
  const [open, setOpen] = useState(false);
  const done = points.filter((p) => p.covered).length;
  return (
    <div className="space-y-1 pt-0.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="tnum flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
        {done} of {points.length} points covered
      </button>
      {open && (
        <ul className="grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2" aria-label="Main points of the next concept">
          {points.map((p, i) => (
            <li key={i} className={cn("flex items-start gap-1.5", p.covered ? "text-foreground" : "text-muted-foreground")}>
              {p.covered ? <CircleCheck className="mt-px size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" /> : <Circle className="mt-px size-3.5 shrink-0" />}
              <span>{p.text}</span>
              <span className="sr-only">{p.covered ? "(covered)" : "(open)"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Bubble({ role, html, text, live }: { role: MimirMessageRole; html: string | null; text: string; live?: boolean }) {
  return (
    <div className={cn("flex items-end gap-2", role === "user" ? "justify-end" : "justify-start")}>
      {role !== "user" && <CoachCanaryAvatar className="size-7" />}
      <div
        className={cn(
          "max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm",
          role === "user" ? "rounded-br-sm bg-brand text-brand-foreground" : "rounded-bl-sm border bg-muted/30",
        )}
        aria-live={live ? "polite" : undefined}
      >
        {html !== null ? <div className="lab-prose text-sm" dangerouslySetInnerHTML={{ __html: html }} /> : <p className="whitespace-pre-wrap">{text}</p>}
      </div>
    </div>
  );
}

type Profile = { role: MimirRepRole | null; coachStyle: MimirCoachStyle; coachPersonality: MimirCoachPersonality };

/** Whose voice the coach speaks in, from its next reply: the "Coach style" menu. */
function PersonalityMenu({ value, onChoose }: { value: MimirCoachPersonality; onChoose: (p: MimirCoachPersonality) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" aria-label={`Coach style: ${MIMIR_COACH_NAMES[value]}`}>
          {MIMIR_COACH_NAMES[value]}
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={value} onValueChange={(p) => p !== value && onChoose(p as MimirCoachPersonality)}>
          {MIMIR_COACH_PERSONALITIES.map((p) => (
            <DropdownMenuRadioItem key={p} value={p}>
              {MIMIR_COACH_NAMES[p]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Your role and how you like to be coached, which the coach reads on every turn, and resetting what it remembers of the chat. */
function CoachOptions({
  profile,
  error,
  onSave,
  onReset,
  resetting,
  disabled,
}: {
  profile: Profile;
  error: string | null;
  onSave: (next: Profile) => void;
  /** Null while there is no conversation to forget. */
  onReset: (() => void) | null;
  resetting: boolean;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { role, coachStyle: style } = profile;
  const save = (next: Pick<Profile, "role" | "coachStyle">) => onSave({ ...profile, ...next });
  const option = (on: boolean) => cn("rounded-md border px-3 py-1.5 text-sm", on ? "border-brand bg-brand-subtle font-medium text-foreground" : "text-muted-foreground hover:bg-muted");
  const labels: Record<MimirCoachStyle, string> = { socratic: "Ask me questions", direct: "Be direct" };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Coach Options
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <div className="space-y-1">
          <DialogTitle>Coach Options</DialogTitle>
          <DialogDescription>Applies from the coach&apos;s next reply.</DialogDescription>
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Your role</p>
          <div className="flex flex-wrap gap-1.5">
            {MIMIR_REP_ROLES.map((r) => (
              <button key={r} type="button" aria-pressed={role === r} className={option(role === r)} onClick={() => save({ role: r, coachStyle: style })}>
                {r}
              </button>
            ))}
            <button type="button" aria-pressed={role === null} className={option(role === null)} onClick={() => save({ role: null, coachStyle: style })}>
              Not saying
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">How to coach you</p>
          <div className="flex flex-wrap gap-1.5">
            {MIMIR_COACH_STYLES.map((s) => (
              <button key={s} type="button" aria-pressed={style === s} className={option(style === s)} onClick={() => save({ role, coachStyle: s })}>
                {labels[s]}
              </button>
            ))}
          </div>
        </div>
        {onReset && (
          <div className="border-t pt-4">
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                onReset();
              }}
            >
              {resetting ? <Loader2 className="animate-spin" /> : <RotateCcw />}
              Reset chat memory
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
