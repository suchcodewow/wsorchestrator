"use client";

/**
 * An item's card in full: its facts, its write-up and folded sections, what
 * it holds (an agent its capabilities), and the coach. Opening it counts as viewing it.
 */

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, ChevronDown, ExternalLink } from "lucide-react";
import type { MimirAttrs, MimirKind } from "@/db/schema";
import type { GlossaryEntry } from "@/lib/mimir/items";
import { KIND_LABELS, TIER_LABELS, type Tier } from "@/lib/mimir/kinds";
import { riseChild, staggerParent } from "@/lib/motion";
import { GlossaryHtml, GlossaryProvider, GlossaryText } from "../../glossary-links";
import { TierBadge } from "../../tier";
import { ChatPanel, type ChatState } from "./chat-panel";

type ItemData = {
  id: string;
  kind: MimirKind;
  title: string;
  emoji: string;
  color: string;
  summary: string;
  attrs: MimirAttrs;
  bodyHtml: string;
  sections: { title: string; html: string }[];
};

type Child = { id: string; kind: MimirKind; title: string; emoji: string; summary: string; attrs: MimirAttrs };

export function ItemView({
  item,
  parent,
  holds,
  tier,
  chat,
  glossary,
}: {
  item: ItemData;
  parent: { id: string; title: string } | null;
  /** The items under it: an agent's capabilities, or a discovery group's questions. */
  holds: Child[];
  tier: Tier;
  chat: ChatState | null;
  /** Every glossary term, for underlining the ones this page uses. */
  glossary: GlossaryEntry[];
}) {
  const router = useRouter();
  useEffect(() => {
    // Opening it is a visit; the refresh moves the header's Continue on to this item.
    void fetch(`/api/mimir/items/${encodeURIComponent(item.id)}/visit`, { method: "POST" })
      .then((res) => res.ok && router.refresh())
      .catch(() => undefined);
  }, [item.id, router]);

  const a = item.attrs;
  const tag = a.badge || a.role || a.tag;
  const facts = factsOf(item.kind, a);

  return (
    <GlossaryProvider entries={glossary}>
    <div className={chat ? "grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_28rem]" : "max-w-3xl"}>
      <motion.article variants={staggerParent(0.04)} initial="hidden" animate="show" className="min-w-0 space-y-6">
        <motion.div variants={riseChild} className="space-y-4">
          <Link
            href={parent ? `/mimir/library/${encodeURIComponent(parent.id)}` : `/mimir/library?kind=${item.kind}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            {parent ? parent.title : KIND_LABELS[item.kind].many}
          </Link>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {tag && <span className="font-medium tracking-wide text-muted-foreground uppercase">{tag}</span>}
              <TierBadge tier={tier}>{TIER_LABELS[tier]}</TierBadge>
            </div>
            <h2 className="flex items-start gap-2.5 text-2xl font-medium tracking-tight">
              {item.emoji && <span aria-hidden>{item.emoji}</span>}
              <span className="border-b-2 pb-0.5" style={item.color ? { borderColor: item.color } : undefined}>
                {item.title}
              </span>
            </h2>
            {item.summary && (
              <p className="max-w-prose leading-relaxed text-muted-foreground">
                <GlossaryText text={item.summary} />
              </p>
            )}
          </div>
        </motion.div>

        {facts.length > 0 && (
          <motion.dl variants={riseChild} className="divide-y overflow-hidden rounded-2xl border bg-card text-sm shadow-sm">
            {facts.map((f) => (
              <div key={f.label} className="space-y-1 px-5 py-4">
                <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{f.label}</dt>
                <dd className="leading-relaxed">
                  {f.href ? (
                    <a href={f.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
                      {f.value}
                      <ExternalLink className="size-3.5" />
                    </a>
                  ) : (
                    <GlossaryText text={f.value} />
                  )}
                </dd>
              </div>
            ))}
          </motion.dl>
        )}

        {item.bodyHtml && (
          <motion.section variants={riseChild} className="rounded-2xl border bg-card px-5 py-4 shadow-sm">
            <GlossaryHtml className="lab-prose" html={item.bodyHtml} />
          </motion.section>
        )}

        {item.sections.length > 0 && (
          <motion.div variants={riseChild} className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
            {item.sections.map((s) => (
              <details key={s.title} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-medium hover:bg-muted/30">
                  {s.title}
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <GlossaryHtml className="lab-prose px-5 pb-4" html={s.html} />
              </details>
            ))}
          </motion.div>
        )}

        {holds.length > 0 && <Children kind={item.kind} items={holds} />}
      </motion.article>

      {chat && (
        <aside className="lg:sticky lg:top-6">
          <ChatPanel itemId={item.id} title={item.title} initial={chat} />
        </aside>
      )}
    </div>
    </GlossaryProvider>
  );
}

type Fact = { label: string; value: string; href?: string };

/** The short fields worth reading before the write-up, by kind. */
function factsOf(kind: MimirKind, a: MimirAttrs): Fact[] {
  const facts: (Fact | false | undefined | "")[] = [];
  switch (kind) {
    case "agent":
    case "capability":
      facts.push(a.buyer && { label: "Primary buyer", value: a.buyer }, a.scenario && { label: "Entry-point scenario", value: a.scenario });
      break;
    case "competitor":
      facts.push(
        a.strength && { label: "Their strength", value: a.strength },
        a.watchOut && { label: "Watch out for", value: a.watchOut },
        a.advantages && { label: "Why Harness", value: a.advantages },
      );
      break;
    case "proof":
    case "framework":
      facts.push(a.headline && { label: "Headline", value: a.headline }, a.url && { label: "Case study", value: "Read it", href: a.url });
      break;
    case "sdlc":
      facts.push(
        a.loop && { label: "Loop", value: a.loop === "inner" ? "Inner loop: software development" : "Outer loop: software delivery" },
        a.mods && a.mods.length > 0 && { label: "Harness capabilities", value: a.mods.join(", ") },
      );
      break;
  }
  facts.push(a.salesAngle && { label: "Sales angle", value: a.salesAngle });
  return facts.filter((f): f is Fact => Boolean(f));
}

function Children({ kind, items }: { kind: MimirKind; items: Child[] }) {
  if (kind === "discovery") {
    return (
      <motion.div variants={riseChild} className="divide-y overflow-hidden rounded-2xl border bg-card text-sm shadow-sm">
        {items.map((q) => (
          <div key={q.id} className="space-y-2 px-5 py-4">
            <p className="font-medium italic">&ldquo;{q.title}&rdquo;</p>
            {q.attrs.why && (
              <p className="leading-relaxed">
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Why this question </span>
                <GlossaryText text={q.attrs.why} />
              </p>
            )}
            {q.attrs.followUp && (
              <p className="leading-relaxed text-muted-foreground">
                <span className="text-xs font-medium tracking-wide uppercase">Follow-up </span>
                &ldquo;{q.attrs.followUp}&rdquo;
              </p>
            )}
          </div>
        ))}
      </motion.div>
    );
  }
  return (
    <motion.section variants={riseChild} className="space-y-3">
      <h3 className="text-sm font-medium">{kind === "agent" ? "Capabilities" : "Breakdown"}</h3>
      <div className="divide-y overflow-hidden rounded-2xl border bg-card text-sm shadow-sm">
        {items.map((c) => (
          <Link key={c.id} href={`/mimir/library/${encodeURIComponent(c.id)}`} className="group flex items-start gap-3 px-5 py-4 hover:bg-muted/30">
            {c.emoji && <span aria-hidden>{c.emoji}</span>}
            <span className="min-w-0 space-y-0.5">
              <span className="block font-medium group-hover:underline">{c.title}</span>
              {c.summary && <span className="block text-muted-foreground">{c.summary}</span>}
            </span>
          </Link>
        ))}
      </div>
    </motion.section>
  );
}
