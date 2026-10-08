/**
 * What each kind of Mimir item is called, how the coach treats it, which
 * fields an editor offers for it, and the progress tiers. Pure, so the pages,
 * the routes and the API reference share it.
 */

import { MIMIR_KINDS, type MimirAttrs, type MimirKind } from "@/db/schema";

/** How the coach runs a conversation about an item. */
export const COACH_MODES = ["agent", "capability", "concept", "sdlc", "persona", "competitive", "usecase"] as const;
export type CoachMode = (typeof COACH_MODES)[number];

export const KIND_LABELS: Record<MimirKind, { one: string; many: string }> = {
  agent: { one: "Agent", many: "Agents" },
  capability: { one: "Capability", many: "Capabilities" },
  ai: { one: "Harness AI", many: "Harness AI" },
  architecture: { one: "Architecture", many: "Architecture" },
  sdlc: { one: "SDLC stage", many: "SDLC" },
  persona: { one: "Persona", many: "Personas" },
  competitor: { one: "Competitor", many: "Competitive" },
  proof: { one: "Proof point", many: "Use cases" },
  framework: { one: "Framework", many: "Frameworks" },
  discovery: { one: "Discovery group", many: "Discovery" },
  question: { one: "Discovery question", many: "Discovery questions" },
  category: { one: "Glossary category", many: "Glossary categories" },
  term: { one: "Glossary term", many: "Glossary" },
  intro: { one: "Tab intro", many: "Tab intros" },
};

/** The coach's mode for each kind it coaches on; the rest have no coach. */
export const COACH_MODE_FOR: Partial<Record<MimirKind, CoachMode>> = {
  agent: "agent",
  capability: "capability",
  architecture: "capability",
  ai: "concept",
  sdlc: "sdlc",
  persona: "persona",
  competitor: "competitive",
  proof: "usecase",
  framework: "usecase",
};

export function coachModeOf(kind: MimirKind): CoachMode | null {
  return COACH_MODE_FOR[kind] ?? null;
}

/** The kinds whose progress is tracked: those the coach covers, and discovery groups, which are reviewed. */
export const PROGRESS_KINDS: readonly MimirKind[] = [
  "agent",
  "capability",
  "ai",
  "architecture",
  "sdlc",
  "persona",
  "competitor",
  "proof",
  "framework",
  "discovery",
];

/** The library's tabs, in order. The glossary has a page of its own. */
export const LIBRARY_KINDS: readonly MimirKind[] = PROGRESS_KINDS;

/** Kinds that must sit under another item, and the kind that item must be. */
export const REQUIRED_PARENT: Partial<Record<MimirKind, MimirKind>> = {
  question: "discovery",
  term: "category",
};

/**
 * Kinds that may sit under another item without having to: a capability
 * under the agent it belongs to. One under no agent is listed with Harness's
 * other products.
 */
export const OPTIONAL_PARENT: Partial<Record<MimirKind, MimirKind>> = {
  capability: "agent",
};

/** The heading capabilities that belong to no agent are listed under, as harness.io lists them. */
export const MORE_PRODUCTS = "More products";

export function isMimirKind(value: unknown): value is MimirKind {
  return MIMIR_KINDS.includes(value as MimirKind);
}

/** The headings a Harness AI item sits under. */
export const AI_GROUPS = ["platform", "agent", "feature"] as const;
export const AI_GROUP_LABELS: Record<(typeof AI_GROUPS)[number], string> = {
  platform: "Platform",
  agent: "AI agents",
  feature: "AI platform features",
};

/**
 * The competitive filters, by the category ids competitor cards carry in
 * `cats`. A category no card carries shows no chip.
 */
export const COMPETITOR_CATEGORIES: { id: string; label: string }[] = [
  { id: "platform", label: "Platform" },
  { id: "cd", label: "CD & Deploy" },
  { id: "ci", label: "CI & Build" },
  { id: "aisre", label: "AI SRE" },
  { id: "flags", label: "Feature Flags" },
  { id: "security", label: "Security" },
  { id: "ai", label: "AI Code" },
  { id: "idp", label: "Dev Portal" },
  { id: "ar", label: "Artifact Registry" },
  { id: "aidi", label: "Eng Intelligence" },
  { id: "finops", label: "FinOps" },
  { id: "iac", label: "IaCM" },
  { id: "chaos", label: "Chaos Eng" },
];

/** One attribute an editor offers: a line, a paragraph, a list of words, or a yes/no. */
export type AttrField = {
  key: keyof MimirAttrs;
  label: string;
  type: "text" | "textarea" | "list" | "boolean" | "number";
  hint?: string;
};

const SALES_ANGLE: AttrField = { key: "salesAngle", label: "Sales angle", type: "textarea" };

/** The attributes each kind offers, in the order the editor shows them. */
export const KIND_FIELDS: Record<MimirKind, AttrField[]> = {
  agent: [
    { key: "buyer", label: "Primary buyer", type: "text" },
    SALES_ANGLE,
  ],
  capability: [
    { key: "badge", label: "Badge", type: "text", hint: "The capability's name on harness.io, such as Deployments." },
    { key: "buyer", label: "Primary buyer", type: "text" },
    { key: "scenario", label: "Entry-point scenario", type: "textarea" },
    SALES_ANGLE,
  ],
  ai: [
    { key: "group", label: "Group", type: "text", hint: "platform, agent or feature." },
    { key: "badge", label: "Badge", type: "text" },
  ],
  architecture: [{ key: "number", label: "Step number", type: "number" }, SALES_ANGLE],
  sdlc: [
    { key: "loop", label: "Loop", type: "text", hint: "inner or outer." },
    { key: "mods", label: "Capabilities", type: "list", hint: "Comma-separated." },
  ],
  persona: [{ key: "role", label: "Buying role", type: "text" }, SALES_ANGLE],
  competitor: [
    { key: "strength", label: "Their strength", type: "textarea" },
    { key: "advantages", label: "Why Harness", type: "textarea" },
    { key: "watchOut", label: "Watch out for", type: "textarea" },
    SALES_ANGLE,
    { key: "cats", label: "Categories", type: "list", hint: "Comma-separated category ids, such as cd, ci." },
    { key: "featured", label: "Top competitor", type: "boolean" },
  ],
  proof: [
    { key: "tag", label: "Tag", type: "text" },
    { key: "headline", label: "Headline", type: "text" },
    { key: "url", label: "Case study link", type: "text" },
  ],
  framework: [
    { key: "tag", label: "Tag", type: "text" },
    { key: "headline", label: "Headline", type: "text" },
    { key: "url", label: "Link", type: "text" },
  ],
  discovery: [],
  question: [
    { key: "why", label: "Why this question", type: "textarea" },
    { key: "followUp", label: "Follow-up", type: "textarea" },
  ],
  category: [],
  term: [
    {
      key: "aliases",
      label: "Matches",
      type: "list",
      hint: "Words in Mimir's other text that link to this term, comma-separated: canary, canary deployment. One in capitals (CI, PR) links only where it is written in capitals. Blank links the title.",
    },
    { key: "seeAlso", label: "See also", type: "text" },
  ],
  intro: [{ key: "forKind", label: "Library tab", type: "text", hint: "The kind it introduces, such as sdlc." }],
};

/** How far someone has got with an item. */
export const TIERS = ["none", "viewed", "practiced", "mastered"] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_LABELS: Record<Tier, string> = {
  none: "Not started",
  viewed: "Viewed",
  practiced: "Practiced",
  mastered: "Mastered",
};

/**
 * The tier a progress row stands for. Mastered needs both the coach's signal
 * and the person's own one-line takeaway.
 */
export function tierOf(
  p: { practicedAt: Date | string | null; masteryReadyAt: Date | string | null; reflection: string } | null,
): Tier {
  if (!p) return "none";
  if (p.masteryReadyAt && p.reflection.trim()) return "mastered";
  if (p.practicedAt) return "practiced";
  return "viewed";
}

/** What narrows a list of items beyond its search. `parentId: null` is top-level items only. */
export type ItemFilter = {
  kind?: MimirKind;
  parentId?: string | null;
  /** A competitor category id from `attrs.cats`. */
  cat?: string;
  featured?: boolean;
};

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function param(params: ParamSource, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return (Array.isArray(value) ? value[0] : value) || undefined;
}

/**
 * The filter a page's or a route's URL asks for: `kind`, `parent` (an item's
 * id, or `none` for top-level items only), `cat` and `featured=1`. An unknown
 * kind is an error rather than no filter, so a typo never lists everything.
 */
export function readItemFilter(params: ParamSource): { filter: ItemFilter } | { error: "invalid_kind" } {
  const filter: ItemFilter = {};
  const kind = param(params, "kind");
  if (kind !== undefined) {
    if (!isMimirKind(kind)) return { error: "invalid_kind" };
    filter.kind = kind;
  }
  const parent = param(params, "parent");
  if (parent !== undefined) filter.parentId = parent === "none" ? null : parent;
  const cat = param(params, "cat");
  if (cat) filter.cat = cat.slice(0, 60);
  if (param(params, "featured") === "1") filter.featured = true;
  return { filter };
}

/** An item's id: lowercase letters, digits, `-` and `_`, starting with a letter or digit. */
export const ITEM_ID = /^[a-z0-9][a-z0-9_-]*$/;

/** A fresh id for an item made in the editor, from its title. */
export function slugFor(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9_]+/g, "-")
    .replace(/^[-_]+|-+$/g, "")
    .slice(0, 60);
  return slug || "item";
}
