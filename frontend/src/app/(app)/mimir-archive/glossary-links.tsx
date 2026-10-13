"use client";

/**
 * Glossary terms underlined wherever Mimir's text uses them, the definition
 * shown on hover or focus. `GlossaryProvider` holds the terms and draws the
 * one popover; `GlossaryHtml` and `GlossaryText` render a block and underline
 * the first use of each term in it. A term's matches are its aliases (its
 * title when it has none); one written in capitals, such as "CI", matches
 * only in capitals, with or without a trailing "s", so "Citi" never links.
 * Links, code and headings are left alone.
 */

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { anchorFloating } from "@/lib/floating";
import type { GlossaryEntry } from "@/lib/mimir/items";

type Form = { entry: GlossaryEntry; form: string; caps: boolean };
type Matcher = { regex: RegExp; forms: Map<string, Form[]>; byId: Map<string, GlossaryEntry> };

const GlossaryContext = createContext<Matcher | null>(null);

const SKIP = "a, code, pre, h1, h2, h3, h4, h5, h6, button, input, textarea, [data-glossary]";
const TERM_CLASS =
  "cursor-help rounded-sm underline decoration-brand/60 decoration-dotted decoration-[1.5px] underline-offset-4 outline-none hover:decoration-brand focus-visible:ring-2 focus-visible:ring-ring/50";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function compile(entries: GlossaryEntry[]): Matcher | null {
  const all: Form[] = [];
  for (const entry of entries) {
    for (const form of entry.aliases.length ? entry.aliases : [entry.title]) {
      const trimmed = form.trim();
      if (trimmed.length < 2) continue;
      all.push({ entry, form: trimmed, caps: /[A-Z]/.test(trimmed) && trimmed === trimmed.toUpperCase() });
    }
  }
  if (all.length === 0) return null;
  all.sort((a, b) => b.form.length - a.form.length);
  const forms = new Map<string, Form[]>();
  for (const f of all) forms.set(f.form.toLowerCase(), [...(forms.get(f.form.toLowerCase()) ?? []), f]);
  const pattern = all.map((f) => escapeRe(f.form) + (f.caps ? "s?" : "")).join("|");
  return {
    regex: new RegExp(`(?<![\\p{L}\\p{N}_-])(?:${pattern})(?![\\p{L}\\p{N}_-])`, "giu"),
    forms,
    byId: new Map(entries.map((e) => [e.id, e])),
  };
}

/** The entry a piece of matched text stands for, honouring the capitals rule; null when only the case matched. */
function entryFor(matcher: Matcher, text: string): GlossaryEntry | null {
  const lower = text.toLowerCase();
  const candidates = [...(matcher.forms.get(lower) ?? []), ...(lower.endsWith("s") ? (matcher.forms.get(lower.slice(0, -1)) ?? []) : [])];
  for (const c of candidates) {
    if (!c.caps) {
      if (c.form.toLowerCase() === lower) return c.entry;
    } else if (text === c.form || text === `${c.form}s`) {
      return c.entry;
    }
  }
  return null;
}

/** Underlines the first use of each term inside `root`. */
function link(root: HTMLElement, matcher: Matcher) {
  const seen = new Set<string>();
  for (const el of root.querySelectorAll<HTMLElement>("[data-glossary]")) seen.add(el.dataset.glossary!);

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(SKIP) && root.contains(node.parentElement.closest(SKIP))
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);

  for (const node of nodes) {
    const text = node.data;
    const pieces: (string | { entry: GlossaryEntry; text: string })[] = [];
    let last = 0;
    matcher.regex.lastIndex = 0;
    for (let m = matcher.regex.exec(text); m; m = matcher.regex.exec(text)) {
      const entry = entryFor(matcher, m[0]);
      if (!entry || seen.has(entry.id)) continue;
      seen.add(entry.id);
      if (m.index > last) pieces.push(text.slice(last, m.index));
      pieces.push({ entry, text: m[0] });
      last = m.index + m[0].length;
    }
    if (pieces.length === 0) continue;
    if (last < text.length) pieces.push(text.slice(last));
    const fragment = document.createDocumentFragment();
    for (const p of pieces) {
      if (typeof p === "string") {
        fragment.append(p);
        continue;
      }
      const span = document.createElement("span");
      span.dataset.glossary = p.entry.id;
      span.tabIndex = 0;
      span.className = TERM_CLASS;
      span.textContent = p.text;
      fragment.append(span);
    }
    node.replaceWith(fragment);
  }
}

function useLinked(html: string) {
  const matcher = useContext(GlossaryContext);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && matcher) link(ref.current, matcher);
  }, [html, matcher]);
  return ref;
}

/** Rendered HTML, with its glossary terms underlined. */
export function GlossaryHtml({ html, className }: { html: string; className?: string }) {
  const ref = useLinked(html);
  return <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Plain text, with its glossary terms underlined. */
export function GlossaryText({ text, className }: { text: string; className?: string }) {
  const html = escapeHtml(text);
  const ref = useLinked(html);
  return <span ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

type Shown = { entry: GlossaryEntry; anchor: HTMLElement };

/** Holds the glossary for everything under it, and draws the definition of the term under the pointer or in focus. */
export function GlossaryProvider({ entries, children }: { entries: GlossaryEntry[]; children: React.ReactNode }) {
  const matcher = useMemo(() => compile(entries), [entries]);
  const [shown, setShown] = useState<Shown | null>(null);
  const popup = useRef<HTMLDivElement>(null);

  // Placed beside its term, flipped and slid to stay on screen, and kept there as the page scrolls.
  useLayoutEffect(() => {
    if (!shown || !popup.current) return;
    return anchorFloating(shown.anchor, popup.current);
  }, [shown]);

  function show(target: EventTarget) {
    const el = target instanceof HTMLElement ? target.closest<HTMLElement>("[data-glossary]") : null;
    const entry = el && matcher?.byId.get(el.dataset.glossary!);
    if (el && entry) setShown({ entry, anchor: el });
  }

  return (
    <GlossaryContext.Provider value={matcher}>
      <div
        onMouseOver={(e) => show(e.target)}
        onMouseOut={(e) => {
          if ((e.target as HTMLElement).closest?.("[data-glossary]")) setShown(null);
        }}
        onFocus={(e) => show(e.target)}
        onBlur={(e) => {
          if ((e.target as HTMLElement).closest?.("[data-glossary]")) setShown(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setShown(null);
        }}
      >
        {children}
      </div>
      {shown && (
        <div
          ref={popup}
          role="tooltip"
          className="pointer-events-none fixed top-0 left-0 z-50 w-80 overflow-hidden rounded-xl border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg"
        >
          <p className="mb-1 font-medium text-brand">{shown.entry.title}</p>
          <p className="leading-relaxed text-muted-foreground">{shown.entry.definition}</p>
        </div>
      )}
    </GlossaryContext.Provider>
  );
}
