/**
 * Turns the Learning Hub's content (`src/data.ts` in harness-learning-hub)
 * into a Mimir import file, which Mimir Settings → Content → Import loads.
 *
 *   cd frontend
 *   npx tsx scripts/mimir-convert.ts ../../harness-learning-hub/src/data.ts > ~/mimir-content.json
 *
 * The content is not public and this repository is, so the file goes
 * wherever you put it, never in here (`.gitignore` refuses `mimir-content*.json`
 * as a backstop). Ids are the hub's own, prefixed where two kinds could
 * collide, so converting and importing again updates what the last import
 * made and leaves people's progress where it was.
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Section = { title: string; content: string };
type HubItem = {
  id: string;
  title?: string;
  n?: string | number;
  co?: string;
  e?: string;
  c?: string;
  b?: string;
  role?: string;
  tag?: string;
  short?: string;
  sum?: string;
  str?: string;
  adv?: string;
  wo?: string;
  sa?: string;
  buyer?: string;
  scenario?: string;
  cats?: string[];
  featured?: boolean;
  hl?: string;
  d?: string;
  url?: string;
  fw?: true;
  sections?: Section[];
  subModules?: HubItem[];
  loop?: string;
  st?: string;
  mods?: string[];
};

type Item = {
  id: string;
  kind: string;
  parentId: string | null;
  position: number;
  title: string;
  emoji: string;
  color: string;
  summary: string;
  body: string;
  sections: Section[];
  attrs: Record<string, unknown>;
};

const source = process.argv[2];
if (!source) {
  console.error("usage: npx tsx scripts/mimir-convert.ts <path to harness-learning-hub/src/data.ts> > out.json");
  process.exit(2);
}

const hub = (await import(pathToFileURL(resolve(source)).href)) as {
  MODS: HubItem[];
  ARCH: HubItem[];
  PERSONAS: HubItem[];
  COMPS: HubItem[];
  PROOFS: HubItem[];
  SDLC_STAGES: HubItem[];
  SDLC_INTRO: string;
  HARNESS_AI: { platform: HubItem[]; agents: HubItem[]; features: HubItem[] };
  DISC: { title: string; qs: { q: string; why: string; fu: string }[] }[];
  GLOSSARY: { id: string; title: string; emoji: string; terms: { term: string; def: string; seeAlso?: string }[] }[];
  GLOSSARY_LOOKUP: Record<string, { label: string }>;
};

/**
 * The hub's short forms that only ever mean the term when written in
 * capitals: "CI", never the "ci" in "Citi". Copied from its App.tsx, where
 * the auto-linking lived.
 */
const UPPERCASE_ONLY = new Set(
  "pr prs ci cd sre slo sli slos iac cve sbom slsa sast dast sca ast mttr e2e api vm vms soc yaml commit waf opa secret secrets drift monolith gha rbac eks ecs aws gcp ide ar fme aita aisre sto ais cacm aidi dbd rt ghas elk".split(
    " ",
  ),
);

/**
 * Every form the hub linked to `term`, its own name first: lowercase, or
 * capitals where only capitals count. A capitals form also matches with a
 * trailing "s", so its plural is left out.
 */
function aliasesFor(term: string): string[] {
  const forms = Object.entries(hub.GLOSSARY_LOOKUP)
    .filter(([, entry]) => entry.label === term)
    .map(([key]) => key);
  const own = term.toLowerCase();
  // "PRs" is "PR" with an s, which the linking allows for; "PRS" in capitals would never match it.
  const plural = (f: string) => UPPERCASE_ONLY.has(f) && f.endsWith("s") && UPPERCASE_ONLY.has(f.slice(0, -1));
  const ordered = [own, ...forms.filter((f) => f !== own && !plural(f))];
  return [...new Set(ordered.map((f) => (UPPERCASE_ONLY.has(f) ? f.toUpperCase() : f)))];
}

/** Drops empty strings, empty lists and undefined, so attrs hold only what a card has. */
function compact(attrs: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(attrs).filter(
      ([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0) && v !== false,
    ),
  );
}

const color = (c?: string) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : "");

function item(kind: string, id: string, position: number, fields: Partial<Item>): Item {
  return {
    id,
    kind,
    parentId: null,
    position,
    title: "",
    emoji: "",
    color: "",
    summary: "",
    body: "",
    sections: [],
    ...fields,
    attrs: compact(fields.attrs ?? {}),
  };
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const items: Item[] = [];

/**
 * The four agents Harness sells, as harness.io describes them (October 2026).
 * The hub predates them: it had four pillars of "modules". Their wording here
 * is the public site's, so it is fine in this repository.
 */
const AGENTS = [
  {
    id: "agent-software-delivery",
    title: "Software Delivery Agent",
    emoji: "🚀",
    color: "#00e3fe",
    summary: "Move changes safely to production: get code and agents from commit to production in minutes.",
    body: `The Software Delivery Agent automates CI/CD, enforces deployment governance, and catches risk before production across builds, deployments and infrastructure — safe delivery at machine speed.

## What it does
- **Create delivery pipelines in minutes**, from plain English, with deep integrations in place of hand-built scripts.
- **Deploy to production with confidence**: canary, blue/green and rolling, with AI verification and automatic rollback.
- **Blistering fast builds**, and pipeline steps that think: run agents in the pipeline.
- **Infrastructure and database automation**, alongside the application.
- **Artifacts you can trust**, code hosting built for agent workloads, and context-aware code review.

## Governance for agent-speed delivery
Policy as code (OPA), deployment freeze windows, enterprise RBAC and an immutable audit trail.`,
  },
  {
    id: "agent-security-testing",
    title: "Security Testing Agent",
    emoji: "🛡️",
    color: "#fd4443",
    summary: "Find and fix risk before production: discover exploitable vulnerabilities, then generate and validate fixes.",
    body: `The Security Testing Agent discovers exploitable vulnerabilities across code, containers and supply chains, then generates and validates fixes automatically through governed pipelines — security that moves at machine speed.

## What it does
- **Keep pace with AI**: find and fix faster, and prioritise the security backlog by what is actually exploitable.
- **Respond instantly to zero-days**, with triage, remediation and zero-day agents.
- **Enforce security checks at machine speed**, and prove every check ran.
- **Secure AI coding**: AI confidence scoring, skill and prompt scanning, model scanning and AI-BOM generation.

## Governance for machine-speed security
Policy as code (OPA), exemption workflows, enterprise RBAC and an immutable audit trail.`,
  },
  {
    id: "agent-runtime-protection",
    title: "Runtime Protection Agent",
    emoji: "🧱",
    color: "#feaa3f",
    summary: "Protect apps, APIs and AI in production against malicious interactions.",
    body: `The Runtime Protection Agent secures every API and defends AI applications in production, autonomously.

## What it does
- **See and score every API you run**, and improve your API posture.
- **Stop attacks hiding in your traffic**: protection against attacks and abuse.
- **Find and secure every AI asset**, and **block AI attacks in real time**.

## Protection that builds trust
Auditable proof, natural-language investigations and simple policy updates.`,
  },
  {
    id: "agent-cost-management",
    title: "Cost Management Agent",
    emoji: "💰",
    color: "#00c8a7",
    summary: "Control cloud and AI costs: own every dollar of cloud and AI spend.",
    body: `The Cost Management Agent keeps cloud and AI spend accountable — allocating cost by team and workload, forecasting spend, and cutting waste before it piles up.

## What it does
- **Know what your AI actually costs**, down to AI spend per shipped feature, and measure engineering ROI.
- **Spot overspending before it compounds**, with budgets and anomaly detection.
- **Catch cloud waste before it adds up**: AutoStopping, Commitment Orchestrator, unit attribution, chargeback and showback.

## Spend control your CFO will trust
Configurable autonomy, budget and policy enforcement, natural-language policy authoring and an immutable audit trail.`,
  },
] as const;

/**
 * Where each of the hub's modules sits now: the agent it is a capability of
 * (null for Harness's other products), and its name on harness.io. The hub's
 * Application Security Testing sub-modules are capabilities of the Security
 * Testing Agent in their own right. A module missing here would be listed
 * with the other products.
 */
const CAPABILITIES: Record<string, { agent: string | null; badge: string }> = {
  cd: { agent: "agent-software-delivery", badge: "Deployments" },
  ci: { agent: "agent-software-delivery", badge: "Builds" },
  ata: { agent: "agent-software-delivery", badge: "Builds · AI Test Automation" },
  iacm: { agent: "agent-software-delivery", badge: "Infrastructure" },
  dbdevops: { agent: "agent-software-delivery", badge: "Databases" },
  artifactreg: { agent: "agent-software-delivery", badge: "Artifacts" },
  ast: { agent: "agent-security-testing", badge: "SAST · SCA" },
  "ast-sast": { agent: "agent-security-testing", badge: "SAST" },
  ssca: { agent: "agent-security-testing", badge: "Supply Chain Security" },
  "ast-sto": { agent: "agent-security-testing", badge: "Security Testing Orchestration" },
  waap: { agent: "agent-runtime-protection", badge: "API Posture · API Advanced Protection" },
  aisec: { agent: "agent-runtime-protection", badge: "AI Posture · AI Firewall" },
  ccm: { agent: "agent-cost-management", badge: "AI & Cloud Costs" },
  sei: { agent: "agent-cost-management", badge: "Engineering Efficiency" },
  aisre: { agent: null, badge: "Incidents" },
  idp: { agent: null, badge: "Developer Portal" },
  resilience: { agent: null, badge: "Resilience Testing" },
  fme: { agent: null, badge: "Runtime Configuration" },
};

AGENTS.forEach((a, i) => {
  const { id, title, emoji, color: c, summary, body } = a;
  items.push(item("agent", id, i, { title, emoji, color: c, summary, body }));
});

const hubModules = hub.MODS.flatMap((m) => [m, ...(m.subModules ?? [])]);
const positions = new Map<string | null, number>();
for (const m of hubModules) {
  const home = CAPABILITIES[m.id] ?? { agent: null, badge: m.b ?? "" };
  const position = positions.get(home.agent) ?? 0;
  positions.set(home.agent, position + 1);
  items.push(
    item("capability", m.id, position, {
      parentId: home.agent,
      title: m.title ?? m.id,
      emoji: m.e ?? "",
      color: color(m.c),
      summary: m.short ?? "",
      body: m.d ?? "",
      sections: m.sections ?? [],
      attrs: { badge: home.badge, buyer: m.buyer, scenario: m.scenario, salesAngle: m.sa },
    }),
  );
}
// Agents first, then their capabilities in the agents' order, then the rest.
const agentOrder = new Map<string | null, number>(AGENTS.map((a, i) => [a.id, i]));
for (const it of items) {
  if (it.kind === "capability") it.position += 100 * (agentOrder.get(it.parentId) ?? AGENTS.length);
}

let ai = 0;
for (const [group, list] of [
  ["platform", hub.HARNESS_AI.platform],
  ["agent", hub.HARNESS_AI.agents],
  ["feature", hub.HARNESS_AI.features],
] as const) {
  for (const a of list) {
    items.push(
      item("ai", a.id, ai++, {
        title: a.title ?? a.id,
        emoji: a.e ?? "",
        color: color(a.c),
        summary: a.short ?? "",
        body: a.d ?? "",
        attrs: { group, badge: a.b },
      }),
    );
  }
}

hub.ARCH.forEach((a, i) =>
  items.push(
    item("architecture", a.id, i, {
      title: a.title ?? String(a.n ?? a.id),
      color: color(a.c),
      summary: a.sum ?? "",
      body: a.d ?? "",
      attrs: { number: typeof a.n === "number" ? a.n : Number(a.n) || undefined, salesAngle: a.sa },
    }),
  ),
);

items.push(
  item("intro", "intro-sdlc", 0, {
    title: "The software delivery lifecycle",
    body: hub.SDLC_INTRO,
    attrs: { forKind: "sdlc" },
  }),
);
hub.SDLC_STAGES.forEach((s, i) =>
  items.push(
    item("sdlc", s.id, i, {
      title: s.st ?? s.title ?? s.id,
      emoji: s.e ?? "",
      color: color(s.c),
      summary: s.short ?? "",
      body: s.d ?? "",
      sections: s.sections ?? [],
      attrs: { loop: s.loop, mods: s.mods },
    }),
  ),
);

hub.PERSONAS.forEach((p, i) =>
  items.push(
    item("persona", p.id, i, {
      title: p.title ?? p.id,
      emoji: p.e ?? "",
      color: color(p.c),
      summary: p.short ?? "",
      body: p.d ?? "",
      sections: p.sections ?? [],
      attrs: { role: p.role, salesAngle: p.sa },
    }),
  ),
);

hub.COMPS.forEach((c, i) =>
  items.push(
    item("competitor", c.id, i, {
      title: String(c.n ?? c.co ?? c.id),
      emoji: c.e ?? "",
      color: color(c.c),
      body: c.d ?? "",
      sections: c.sections ?? [],
      attrs: {
        strength: c.str,
        advantages: c.adv,
        watchOut: c.wo,
        salesAngle: c.sa,
        cats: c.cats,
        featured: c.featured,
      },
    }),
  ),
);

let proof = 0;
let framework = 0;
for (const p of hub.PROOFS) {
  const kind = p.fw ? "framework" : "proof";
  items.push(
    item(kind, p.id, p.fw ? framework++ : proof++, {
      title: p.co ?? p.id,
      emoji: p.e ?? "",
      color: color(p.c),
      summary: p.sum ?? "",
      body: p.d ?? "",
      attrs: { tag: p.tag, headline: p.hl, url: p.url },
    }),
  );
}

hub.DISC.forEach((g, gi) => {
  const groupId = `disc-${gi}`;
  items.push(item("discovery", groupId, gi, { title: g.title }));
  g.qs.forEach((q, qi) =>
    items.push(
      item("question", `${groupId}-${qi}`, qi, {
        parentId: groupId,
        title: q.q,
        attrs: { why: q.why, followUp: q.fu },
      }),
    ),
  );
});

const termIds = new Set<string>();
hub.GLOSSARY.forEach((cat, ci) => {
  const categoryId = `glossary-${slug(cat.id)}`;
  items.push(item("category", categoryId, ci, { title: cat.title, emoji: cat.emoji }));
  cat.terms.forEach((t, ti) => {
    const base = `term-${slug(t.term) || "term"}`;
    let id = base;
    for (let n = 2; termIds.has(id); n++) id = `${base}-${n}`;
    termIds.add(id);
    items.push(
      item("term", id, ti, { parentId: categoryId, title: t.term, summary: t.def, attrs: { seeAlso: t.seeAlso, aliases: aliasesFor(t.term) } }),
    );
  });
});

/**
 * Harness no longer sells modules, so the hub's "CD module", "Harness
 * modules" and the like become capabilities. A module that really is one —
 * Terraform, OpenTofu or Go modules, a module registry — is left alone.
 */
const KEEP = /\b(?:Terraform|OpenTofu|Tofu|Go|Python|npm|Node|IaC|Helm|reusable|private|public|infrastructure)\s+modules?\b|\bmodules?\s+(?:registry|orchestration|sources?|versions?)\b|\bsubmodules?\b/gi;

function capabilities(text: string): string {
  const kept: string[] = [];
  const held = text.replace(KEEP, (m) => `\u0000${kept.push(m) - 1}\u0000`);
  const swapped = held.replace(/\b([Mm])odule(s?)\b|\bMODULE(S?)\b/g, (_, m: string | undefined, s: string | undefined, upper: string | undefined) => {
    if (m === undefined) return upper ? "CAPABILITIES" : "CAPABILITY";
    const word = s ? "apabilities" : "apability";
    return `${m === "M" ? "C" : "c"}${word}`;
  });
  return swapped.replace(/\u0000(\d+)\u0000/g, (_, i: string) => kept[Number(i)]!);
}

let rewritten = 0;
for (const it of items) {
  const before = JSON.stringify(it);
  it.title = capabilities(it.title);
  it.summary = capabilities(it.summary);
  it.body = capabilities(it.body);
  it.sections = it.sections.map((s) => ({ title: capabilities(s.title), content: capabilities(s.content) }));
  for (const [k, v] of Object.entries(it.attrs)) {
    if (typeof v === "string") it.attrs[k] = capabilities(v);
    else if (Array.isArray(v)) it.attrs[k] = v.map((x) => (typeof x === "string" ? capabilities(x) : x));
  }
  if (JSON.stringify(it) !== before) rewritten++;
}

process.stdout.write(`${JSON.stringify({ items }, null, 1)}\n`);
console.error(`"module" became "capability" in ${rewritten} items`);
const counts = items.reduce<Record<string, number>>((n, i) => ({ ...n, [i.kind]: (n[i.kind] ?? 0) + 1 }), {});
console.error(`${items.length} items: ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(", ")}`);
