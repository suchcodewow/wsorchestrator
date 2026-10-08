"use client";

/**
 * The coach, beside an item: the conversation so far, a box to answer in,
 * and, once the coach says the rep is ready, the one-line takeaway that makes
 * the item mastered. The rep's message shows at once and the coach's reply
 * streams in as it is written; the saved reply then takes its place, rendered
 * and with its glossary terms underlined. A long conversation shows its
 * latest turns, with the earlier ones a click away.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronUp, Loader2, MessageSquarePlus, SendHorizontal, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MIMIR_MESSAGE_MAX, MIMIR_REFLECTION_MAX, type MimirMessageRole } from "@/db/schema";
import type { CoachMode, Tier } from "@/lib/mimir/kinds";
import { cn } from "@/lib/utils";
import { GlossaryHtml } from "../../glossary-links";

export type ChatMessageData = { seq: number; role: MimirMessageRole; text: string; html: string | null; at: string };

export type ChatState = {
  mode: CoachMode;
  conversation: { id: string; messages: ChatMessageData[]; earlier: boolean } | null;
  opener: { text: string; html: string } | null;
  progress: { tier: Tier; masteryReady: boolean; reflection: string };
  configured: boolean;
};

const SUBTITLE: Record<CoachMode, string> = {
  agent: "Tell the agent story · get challenged · master it",
  capability: "Explain it · get challenged · master it",
  concept: "Understand it · explore it · explain it",
  sdlc: "Understand it · explore it · explain it",
  persona: "Roleplay the call · get coached",
  competitive: "Handle the objection · get coached",
  usecase: "Tell the story · get coached",
};

const ERRORS: Record<string, string> = {
  busy: "The coach is still answering your last message.",
  full: "This conversation is as long as the coach can read. Start a new conversation to keep going; your progress stays.",
  refused: "The coach declined to answer that. Try putting it another way.",
  upstream: "The coach couldn't be reached. Try again in a moment.",
  not_configured: "The coach isn't set up on this server yet.",
  impersonating: "You're viewing the app as someone else, so you can't send messages.",
};

const MARKER = "[MASTERY_UNLOCKED]";

type Done = { messages: ChatMessageData[]; masteryReady: boolean; tier: Tier };

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

export function ChatPanel({ itemId, title, initial }: { itemId: string; title: string; initial: ChatState }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [streaming, setStreaming] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const base = `/api/mimir/items/${encodeURIComponent(itemId)}`;

  const messages: ChatMessageData[] = state.conversation
    ? state.conversation.messages
    : state.opener
      ? [{ seq: 1, role: "assistant", text: state.opener.text, html: state.opener.html, at: "" }]
      : [];

  useEffect(() => {
    if (stick.current) scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages.length, pending, streaming]);

  async function send() {
    const message = draft.trim();
    if (!message || pending) return;
    stick.current = true;
    setPending(message);
    setStreaming("");
    setDraft("");
    setError(null);
    let done: Done | null = null;
    let failed: string | null = null;
    try {
      const res = await fetch(`${base}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ message }),
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
      if (!state.conversation) {
        // The first message started the conversation; read it back whole.
        setState(await fetch(`${base}/chat`).then((r) => r.json()));
      } else {
        setState((s) => ({
          ...s,
          conversation: s.conversation && { ...s.conversation, messages: [...s.conversation.messages, ...result.messages] },
          progress: { ...s.progress, masteryReady: result.masteryReady, tier: result.tier },
        }));
      }
      router.refresh();
    } else {
      setError(failed);
      setDraft(message);
    }
    setPending(null);
    setStreaming("");
  }

  async function loadEarlier() {
    const first = state.conversation?.messages[0];
    if (!first) return;
    setLoadingEarlier(true);
    stick.current = false;
    try {
      const page = (await fetch(`${base}/chat?before=${first.seq}`).then((r) => r.json())) as ChatState;
      const older = page.conversation;
      if (older) {
        setState((s) => ({
          ...s,
          conversation: s.conversation && {
            ...s.conversation,
            messages: [...older.messages, ...s.conversation.messages],
            earlier: older.earlier,
          },
        }));
      }
    } finally {
      setLoadingEarlier(false);
    }
  }

  async function newConversation() {
    if (!window.confirm(`Start a new conversation about ${title}? This one will be deleted; your progress stays.`)) return;
    setResetting(true);
    setError(null);
    try {
      const res = await fetch(`${base}/chat`, { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(ERRORS[body?.error ?? ""] ?? `Could not start a new conversation (${res.status}).`);
        return;
      }
      stick.current = true;
      setState(await fetch(`${base}/chat`).then((r) => r.json()));
    } catch {
      setError("Could not reach the server.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <section className="flex max-h-[calc(100dvh-8rem)] min-h-[28rem] flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
      <header className="flex items-center justify-between gap-3 border-b px-5 py-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 font-medium">
            <Sparkles className="size-4 text-brand" />
            Coach
          </h3>
          <p className="truncate text-xs text-muted-foreground">{SUBTITLE[state.mode]}</p>
        </div>
        {state.conversation && (
          <Button variant="ghost" size="sm" onClick={() => void newConversation()} disabled={resetting || pending !== null}>
            {resetting ? <Loader2 className="animate-spin" /> : <MessageSquarePlus />}
            New conversation
          </Button>
        )}
      </header>

      <div
        ref={scroller}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {state.conversation?.earlier && (
          <div className="flex justify-center">
            <Button variant="ghost" size="sm" disabled={loadingEarlier} onClick={() => void loadEarlier()}>
              {loadingEarlier ? <Loader2 className="animate-spin" /> : <ChevronUp />}
              Earlier messages
            </Button>
          </div>
        )}
        {messages.map((m) => (
          <Bubble key={m.seq} role={m.role} html={m.html} text={m.text} />
        ))}
        {pending && (
          <>
            <Bubble role="user" html={null} text={pending} />
            {streaming ? (
              <Bubble role="assistant" html={null} text={streaming.replaceAll(MARKER, "")} live />
            ) : (
              <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                The coach is thinking…
              </div>
            )}
          </>
        )}
        {state.progress.masteryReady && <Takeaway base={base} progress={state.progress} onSaved={(p) => setState((s) => ({ ...s, progress: p }))} />}
      </div>

      <footer className="space-y-2 border-t px-4 py-3">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {!state.configured ? (
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
              disabled={pending !== null}
            />
            <Button type="submit" variant="brand" size="icon" aria-label="Send" disabled={!draft.trim() || pending !== null}>
              {pending ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
            </Button>
          </form>
        )}
      </footer>
    </section>
  );
}

function Bubble({ role, html, text, live }: { role: MimirMessageRole; html: string | null; text: string; live?: boolean }) {
  return (
    <div className={cn("flex", role === "user" ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm",
          role === "user" ? "rounded-br-sm bg-brand text-brand-foreground" : "rounded-bl-sm border bg-muted/30",
        )}
        aria-live={live ? "polite" : undefined}
      >
        {html !== null ? <GlossaryHtml className="lab-prose text-sm" html={html} /> : <p className="whitespace-pre-wrap">{text}</p>}
      </div>
    </div>
  );
}

/** Once the coach says the rep is ready: the one line, in their own words, that makes it mastered. */
function Takeaway({
  base,
  progress,
  onSaved,
}: {
  base: string;
  progress: ChatState["progress"];
  onSaved: (p: ChatState["progress"]) => void;
}) {
  const saved = progress.reflection;
  const [editing, setEditing] = useState(!saved);
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const reflection = draft.trim();
    if (!reflection) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/reflection`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reflection }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(ERRORS[body?.error ?? ""] ?? `Could not save (${res.status}).`);
        return;
      }
      onSaved({ ...progress, reflection, tier: body.tier });
      setEditing(false);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-2.5 text-sm">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <p className="min-w-0 flex-1">
          <span className="font-medium">Mastered.</span> <span className="italic text-muted-foreground">&ldquo;{saved}&rdquo;</span>
        </p>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          Edit
        </Button>
      </div>
    );
  }
  return (
    <form
      className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3.5 py-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label htmlFor="mimir-takeaway" className="font-medium">
        Lock it in: in one sentence, how would you pitch or explain this?
      </label>
      <div className="flex gap-2">
        <Input
          id="mimir-takeaway"
          value={draft}
          maxLength={MIMIR_REFLECTION_MAX}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Your one-line takeaway"
        />
        <Button type="submit" variant="brand" disabled={busy || !draft.trim()}>
          {busy && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
