"use client";

/**
 * One kind of item as cards: capabilities under the agent each belongs to
 * (and Harness's other products after them), Harness AI under its three
 * headings, competitors filtered by category, and the rest as they come. Each card opens the item and shows how far the reader has got.
 */

import Link from "next/link";
import { motion } from "framer-motion";
import { Pager, TableSearch } from "@/components/data-table";
import type { MimirKind } from "@/db/schema";
import { AI_GROUPS, AI_GROUP_LABELS, COMPETITOR_CATEGORIES, KIND_LABELS, LIBRARY_KINDS, MORE_PRODUCTS, type Tier } from "@/lib/mimir/kinds";
import type { MimirItemSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { ChipNav } from "../chip-nav";
import { TierDot } from "../tier";
import type { Card } from "./page";

const LIBRARY = "/mimir/library";

function hrefFor(kind: MimirKind, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ kind, ...extra });
  return `${LIBRARY}?${params}`;
}

export function LibraryView({
  kind,
  query,
  cat,
  featured,
  count,
  page,
  agents,
  intro,
  tiers,
}: {
  kind: MimirKind;
  query: ListQuery<MimirItemSort>;
  cat: string | null;
  featured: boolean;
  count: number;
  page: Page<Card>;
  /** The agents, for heading the capabilities under them. */
  agents: Card[];
  intro: { title: string; html: string } | null;
  tiers: Record<string, Tier>;
}) {
  const noun = KIND_LABELS[kind];
  const groups = groupCards(kind, page.rows, agents);

  return (
    <motion.div variants={staggerParent(0.04)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild}>
        <ChipNav
          label="Library"
          chips={LIBRARY_KINDS.map((k) => ({ href: hrefFor(k), label: KIND_LABELS[k].many, active: k === kind }))}
        />
      </motion.div>

      <motion.div variants={riseChild} className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1.5">
          <h2 className="text-xl font-medium tracking-tight">{noun.many}</h2>
          <p className="text-sm text-muted-foreground tnum">
            <span className="font-medium text-foreground">{count.toLocaleString()}</span>{" "}
            {count === 1 ? noun.one.toLowerCase() : "items"}
          </p>
        </div>
        <TableSearch value={query.q} placeholder={`Search ${noun.many.toLowerCase()}`} label={`Search ${noun.many}`} className="w-full sm:w-72" />
      </motion.div>

      {kind === "competitor" && (
        <motion.div variants={riseChild}>
          <ChipNav
            label="Competitor categories"
            chips={[
              { href: hrefFor(kind), label: "All", active: !cat && !featured },
              { href: hrefFor(kind, { featured: "1" }), label: "Top", active: featured },
              ...COMPETITOR_CATEGORIES.map((c) => ({ href: hrefFor(kind, { cat: c.id }), label: c.label, active: cat === c.id })),
            ]}
          />
        </motion.div>
      )}

      {intro && !query.q && (
        <motion.section variants={riseChild} className="rounded-2xl border bg-card px-5 py-4 text-sm shadow-sm">
          <div className="lab-prose" dangerouslySetInnerHTML={{ __html: intro.html }} />
        </motion.section>
      )}

      {page.rows.length === 0 && (
        <motion.p variants={riseChild} className="rounded-2xl border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
          {query.q || cat || featured ? "Nothing matches that." : `No ${noun.many.toLowerCase()} yet.`}
        </motion.p>
      )}

      {groups.map((g) => (
        <motion.section key={g.key} variants={riseChild} className="space-y-3">
          {g.heading && (
            <h3 className="flex items-baseline gap-2 text-sm font-medium">
              {g.heading.emoji && <span aria-hidden>{g.heading.emoji}</span>}
              {g.heading.href ? (
                <Link href={g.heading.href} className="hover:underline">
                  {g.heading.title}
                </Link>
              ) : (
                <span>{g.heading.title}</span>
              )}
            </h3>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {g.cards.map((c) => (
              <ItemCard key={c.id} card={c} tier={tiers[c.id] ?? "none"} />
            ))}
          </div>
        </motion.section>
      ))}

      <Pager page={page} noun={noun.many.toLowerCase()} />
    </motion.div>
  );
}

type Group = { key: string; heading: { emoji?: string; title: string; href?: string } | null; cards: Card[] };

/**
 * Capabilities under their agents, then the ones under no agent as Harness's
 * other products; Harness AI under its headings. Each in the order the page
 * gave them; everything else in one run.
 */
function groupCards(kind: MimirKind, cards: Card[], agents: Card[]): Group[] {
  if (kind === "capability") {
    const groups: Group[] = agents.map((a) => ({
      key: a.id,
      heading: { emoji: a.emoji, title: a.title, href: `${LIBRARY}/${encodeURIComponent(a.id)}` },
      cards: cards.filter((c) => c.parentId === a.id),
    }));
    const rest = cards.filter((c) => !agents.some((a) => a.id === c.parentId));
    if (rest.length) groups.push({ key: "more", heading: { title: MORE_PRODUCTS }, cards: rest });
    return groups.filter((g) => g.cards.length > 0);
  }
  if (kind === "ai") {
    const groups: Group[] = AI_GROUPS.map((k) => ({
      key: k,
      heading: { title: AI_GROUP_LABELS[k] },
      cards: cards.filter((c) => c.attrs.group === k),
    }));
    const rest = cards.filter((c) => !AI_GROUPS.includes(c.attrs.group as (typeof AI_GROUPS)[number]));
    if (rest.length) groups.push({ key: "other", heading: { title: "Other" }, cards: rest });
    return groups.filter((g) => g.cards.length > 0);
  }
  return cards.length ? [{ key: "all", heading: null, cards }] : [];
}

function ItemCard({ card, tier }: { card: Card; tier: Tier }) {
  const a = card.attrs;
  const tag = a.badge || a.role || a.tag || (typeof a.number === "number" ? `Step ${a.number}` : "");
  const blurb = card.summary || a.headline || a.strength || "";
  return (
    <Link
      href={`${LIBRARY}/${encodeURIComponent(card.id)}`}
      className="group flex h-full flex-col gap-2 rounded-2xl border border-l-4 bg-card px-4 py-3.5 text-sm shadow-sm transition-colors hover:border-brand-border/70 hover:bg-accent/30"
      style={card.color ? { borderLeftColor: card.color } : undefined}
    >
      <div className="flex items-start gap-2">
        {card.emoji && (
          <span aria-hidden className="text-lg leading-6">
            {card.emoji}
          </span>
        )}
        <span className="min-w-0 flex-1 font-medium leading-6 group-hover:underline">{card.title}</span>
        <TierDot tier={tier} className="mt-2" />
      </div>
      {tag && <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{tag}</span>}
      {blurb && <p className="line-clamp-3 text-muted-foreground">{blurb}</p>}
    </Link>
  );
}
