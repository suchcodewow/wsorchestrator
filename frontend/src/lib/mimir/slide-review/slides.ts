/**
 * Review the "Our understanding" slide: ten made-up versions of the slide a
 * team builds to play a customer's priorities back to them, each in the shape
 * of the EMD deck's (current state against future state, then the required
 * capabilities), and each with 10 to 15 small things wrong with it. A slide is
 * written here as it should be; every flaw names one element of it and how
 * that element looks while it is wrong. Clicking the element puts it right.
 * Every customer, product claim and number is invented, and nothing is kept.
 * The slide is seen smaller than in a presentation, so each mistake is made
 * plain enough to spot at that size: five spaces rather than two, a shift of
 * 20 pixels rather than 8, a font far from Geist rather than one close to it.
 */

export type RowIndex = 0 | 1 | 2 | 3 | 4;
export type Side = "current" | "future";
export type RowPart = "head" | "sub" | "icon";

/** One clickable piece of a slide. Only a flaw's `extra` adds a piece that a finished slide doesn't have. */
export type Target =
  | "title"
  | "subtitle"
  | "logo"
  | `header.${Side}`
  | `headerIcon.${Side}`
  | `${Side}.${RowIndex}.${RowPart}`
  | "capabilitiesTitle"
  | `capability.${number}`
  | "capabilitiesBox"
  | "arrow"
  | "divider"
  | "extra";

export type SlideFont = "geist" | "geist-mono" | "georgia" | "arial" | "times" | "verdana" | "courier" | "comic";

export type FlawKind =
  | "spelling"
  | "grammar"
  | "punctuation"
  | "capitalization"
  | "consistency"
  | "font"
  | "size"
  | "style"
  | "color"
  | "alignment"
  | "spacing"
  | "icon"
  | "layout"
  | "leftover";

export const KIND_LABEL: Record<FlawKind, string> = {
  spelling: "Spelling",
  grammar: "Grammar",
  punctuation: "Punctuation",
  capitalization: "Capitalization",
  consistency: "Consistency",
  font: "Font",
  size: "Font size",
  style: "Bold or italic",
  color: "Color",
  alignment: "Alignment",
  spacing: "Spacing",
  icon: "Icon",
  layout: "Layout",
  leftover: "Left behind",
};

/** How an element differs while it is wrong. Anything left out looks as it should. */
export type Look = {
  /** The element's words, or a capability's lead-in. */
  text?: string;
  /** A capability's measure; empty drops the arrow with it. */
  metric?: string;
  arrow?: string;
  bullet?: string;
  font?: SlideFont;
  /** In pixels of the 1280 × 720 slide. */
  size?: number;
  weight?: number;
  italic?: boolean;
  color?: string;
  dx?: number;
  dy?: number;
  /** An icon, the logo or the arrow drawn bigger or smaller. */
  scale?: number;
  /** The logo pulled wider (over 1) or squashed (under 1). */
  stretch?: number;
  /** The wrong mark: a tick on the current-state side, a cross on the future one. */
  icon?: "check" | "cross";
  highlight?: boolean;
  underline?: boolean;
  /** The capabilities box drawn with a solid edge instead of a dashed one. */
  solid?: boolean;
  /** The arrow pointing from the future back to the current state. */
  pointLeft?: boolean;
};

/** Something left on the slide that shouldn't be there at all. */
export type Extra = { text: string; x: number; y: number; style: "placeholder" | "sticky" };

export type Flaw = { target: Target; kind: FlawKind; note: string; look: Look; extra?: Extra };

export type Row = { head: string; sub: string };
export type Capability = { lead: string; metric: string };

export type Slide = {
  id: string;
  subtitle: string;
  current: [Row, Row, Row, Row, Row];
  future: [Row, Row, Row, Row, Row];
  capabilities: Capability[];
  flaws: Flaw[];
};

export const TITLE = "Our understanding…";
export const CAPABILITIES_TITLE = "Required capabilities";
export const ARROW = "→";
export const BULLET = "●";

export const POINTS = { found: 1, wrongClick: -1, missed: -2 } as const;

const r = (head: string, sub: string): Row => ({ head, sub });
const c = (lead: string, metric: string): Capability => ({ lead, metric });
const f = (target: Target, kind: FlawKind, note: string, look: Look, extra?: Extra): Flaw => ({
  target,
  kind,
  note,
  look,
  ...(extra && { extra }),
});

export const SLIDES: Slide[] = [
  {
    id: "software-delivery",
    subtitle: "Software Delivery Agent",
    current: [
      r("Coding outpaces safe delivery speed", "AI coding tool investment is blocked"),
      r("Code, infra, GitOps, DB run on separate toolsets", "Developer time wasted on rollbacks and hotfixes"),
      r("Every change needs the same manual approval", "Innovation velocity slowed by unnecessary human-in-the-loop"),
      r("Pipelines are crafted per service or application", "Teams buried in toil, not high-value work"),
      r("Governance bolted on, not built in", "Compliance issues and risk level are growing"),
    ],
    future: [
      r("Delivery keeps pace with coding", "ROI of coding tools is realized"),
      r("One governed path for code, infra, DB", "Fewer failures, faster recovery"),
      r("Teams choose autonomy level based on risk", "Teams shift from toil to innovation"),
      r("Multi-service releases auto-coordinated", "Multi-service launches ship on time"),
      r("Governance built into every pipeline", "Reduce compliance gaps"),
    ],
    capabilities: [
      c("Agents generate, improve & explain pipelines", "% increase of deployments"),
      c("Agentic pipeline steps handle complexity", "# of autonomous steps"),
      c("Risk-based autonomy, consistent policy", "# of manual approvals"),
      c("Golden paths consolidate pipeline sprawl", "# of required pipelines"),
      c("Deployments are verified & rolled back automatically", "MTTR"),
    ],
    flaws: [
      f("title", "punctuation", "Two full stops where the template has an ellipsis.", { text: "Our understanding.." }),
      f("current.0.sub", "spacing", "A run of extra spaces between “is” and “blocked”.", { text: "AI coding tool investment is     blocked" }),
      f("current.1.head", "font", "Set in Times New Roman instead of the slide’s Geist.", { font: "times" }),
      f("current.2.sub", "spelling", "“unneccessary” should be “unnecessary”.", {
        text: "Innovation velocity slowed by unneccessary human-in-the-loop",
      }),
      f("current.3.icon", "icon", "A green tick on a current-state problem; it should be the red cross.", { icon: "check" }),
      f("future.0.head", "grammar", "“Delivery keep pace” should be “Delivery keeps pace”.", { text: "Delivery keep pace with coding" }),
      f("future.1.sub", "style", "Not italic, unlike every other outcome line.", { italic: false }),
      f("future.3.head", "alignment", "Nudged right of the column’s left edge.", { dx: 20 }),
      f("future.4.sub", "capitalization", "Title case; every other outcome line is sentence case.", { text: "Reduce Compliance Gaps" }),
      f("header.future", "capitalization", "“Future State” is title case; “Current state” is sentence case.", { text: "Future State" }),
      f("capability.2", "consistency", "A typed “->” instead of the → arrow the other lines use.", { arrow: "->" }),
      f("capability.4", "spelling", "“automaticaly” should be “automatically”.", {
        text: "Deployments are verified & rolled back automaticaly",
      }),
      f("logo", "layout", "The Harness logo is stretched out of proportion.", { stretch: 1.5 }),
    ],
  },
  {
    id: "platform-priorities",
    subtitle: "Confirming your priorities re: Software Delivery, Testing, Runtime Protection & Cost Management",
    current: [
      r("Coding outpaces safe delivery speed", "AI coding tool investment is blocked"),
      r("Every change needs the same manual approval", "Innovation velocity slowed by unnecessary human-in-the-loop"),
      r("Governance bolted on, not built in", "Compliance issues and risk level are growing"),
      r("Overwhelming volume of vulnerability discovery", "More findings than security can triage or fix"),
      r("Can’t respond quickly to zero-days", "Never know exposure or what needs to be patched"),
    ],
    future: [
      r("Delivery keeps pace with coding", "ROI of coding tools is realized"),
      r("Teams choose autonomy level based on risk", "Teams shift from toil to innovation"),
      r("Governance built into every pipeline", "Reduce compliance gaps"),
      r("Prioritize and fix vulnerabilities in minutes", "More secure production environment"),
      r("Fast, repeatable response to any zero-day", "Understand exposure, mitigate risk in minutes"),
    ],
    capabilities: [
      c("Agents generate, improve & explain pipelines", "% increase of deployments"),
      c("Agentic pipeline steps handle complexity", "# of autonomous steps"),
      c("Risk-based autonomy, consistent policy", "# of manual approvals"),
      c("Reachability-based prioritization, agentic workflow", "% of vulnerabilities remediated within SLA"),
      c("Agentic zero-day response", "zero-day MTTR (mean time to remediate)"),
    ],
    flaws: [
      f("subtitle", "grammar", "“you’re priorities” should be “your priorities”.", {
        text: "Confirming you’re priorities re: Software Delivery, Testing, Runtime Protection & Cost Management",
      }),
      f("headerIcon.current", "icon", "Both headings carry a tick; current state should have the red cross.", { icon: "check" }),
      f("current.1.head", "size", "Larger than the other headlines.", { size: 20 }),
      f("current.2.icon", "icon", "This cross is bigger than the others.", { scale: 2 }),
      f("current.3.sub", "color", "Blue text where every other line is black.", { color: "#2563eb" }),
      f("current.4.head", "punctuation", "“Cant” is missing its apostrophe.", { text: "Cant respond quickly to zero-days" }),
      f("future.0.sub", "spacing", "Sits further below its headline than the other rows do.", { dy: 10 }),
      f("future.2.sub", "font", "Set in Times New Roman instead of Geist.", { font: "times" }),
      f("future.3.head", "style", "Bold, where the other headlines are medium weight.", { weight: 800 }),
      f("future.4.head", "consistency", "“0-day” here, “zero-day” everywhere else on the slide.", {
        text: "Fast, repeatable response to any 0-day",
      }),
      f("capabilitiesTitle", "capitalization", "“Required Capabilities” should be sentence case like the other headings.", {
        text: "Required Capabilities",
      }),
      f("capability.1", "spelling", "“autonomus” should be “autonomous”.", { metric: "# of autonomus steps" }),
      f("capability.3", "consistency", "A dash for a bullet where the others are dots.", { bullet: "–" }),
      f("arrow", "alignment", "The arrow has drifted off the divider between the columns.", { dx: 40 }),
    ],
  },
  {
    id: "continuous-integration",
    subtitle: "Confirming your priorities re: Continuous Integration & Test Intelligence",
    current: [
      r("Builds take 45 minutes on average", "Developers context-switch while they wait"),
      r("Every commit runs the full test suite", "Compute spend grows with every new test"),
      r("Flaky tests block merges daily", "Engineers rerun pipelines instead of fixing code"),
      r("Build scripts copied between repositories", "A single change has to be made in 200 places"),
      r("No insight into where build time goes", "Optimization efforts are guesswork"),
    ],
    future: [
      r("Builds finish in under 10 minutes", "Developers stay in flow"),
      r("Only the tests a change affects run", "Lower compute cost per commit"),
      r("Flaky tests quarantined automatically", "Merges are never blocked by noise"),
      r("Reusable templates for every build", "One change updates every pipeline"),
      r("Build insights for every stage", "Teams know exactly what to speed up"),
    ],
    capabilities: [
      c("Test Intelligence selects tests by code change", "% reduction in test time"),
      c("Build cache and build intelligence", "average build duration"),
      c("Flaky test detection and quarantine", "# of blocked merges"),
      c("Pipeline templates with central governance", "# of pipeline definitions"),
    ],
    flaws: [
      f("title", "font", "Set in Arial; the template’s title font is Georgia.", { font: "arial" }),
      f("current.0.head", "spelling", "“minuets” should be “minutes”.", { text: "Builds take 45 minuets on average" }),
      f("current.1.sub", "grammar", "“Compute spend grow” should be “Compute spend grows”.", {
        text: "Compute spend grow with every new test",
      }),
      f("current.2.head", "capitalization", "Title case; every other headline is sentence case.", { text: "Flaky Tests Block Merges Daily" }),
      f("current.4.icon", "alignment", "This cross sits lower than its line.", { dy: 9 }),
      f("future.0.head", "alignment", "Pulled left of the column’s edge.", { dx: -18 }),
      f("future.1.head", "grammar", "“effects” should be “affects”.", { text: "Only the tests a change effects run" }),
      f("future.3.sub", "color", "Grey where the other outcome lines are black.", { color: "#9b9b97" }),
      f("future.4.sub", "size", "Smaller than the other outcome lines.", { size: 10 }),
      f("capability.0", "font", "Set in Verdana instead of Geist.", { font: "verdana" }),
      f("capability.2", "consistency", "A “=>” where the other lines use the → arrow.", { arrow: "=>" }),
      f("capabilitiesBox", "consistency", "A solid edge where the template’s box is dashed.", { solid: true }),
      f("extra", "leftover", "An empty “Click to add text” box was left on the slide.", {}, {
        text: "Click to add text",
        x: 960,
        y: 560,
        style: "placeholder",
      }),
    ],
  },
  {
    id: "application-security",
    subtitle: "Confirming your priorities re: Application Security & Supply Chain",
    current: [
      r("Scanners run late, just before release", "Vulnerabilities found when they cost most to fix"),
      r("Results spread across nine different tools", "No single view of risk"),
      r("Every finding treated as critical", "Developers ignore alerts they can’t act on"),
      r("No inventory of open-source components", "Exposure to new CVEs is unknown"),
      r("Audit evidence gathered by hand", "Each audit costs weeks of engineering time"),
    ],
    future: [
      r("Scans run on every pull request", "Issues fixed while the code is fresh"),
      r("One normalized view across all scanners", "Risk is visible in one place"),
      r("Findings prioritized by reachability", "Developers fix what matters first"),
      r("SBOM generated for every artifact", "Know your exposure within minutes"),
      r("Evidence collected automatically", "Audits become routine"),
    ],
    capabilities: [
      c("Shift-left scanning in every pipeline", "mean time to remediate"),
      c("Deduplicated, normalized findings", "# of tools to review"),
      c("Reachability analysis and exemptions", "% of critical findings fixed within SLA"),
      c("SBOM and SLSA attestation for every build", "% of artifacts with provenance"),
      c("Policy as code for audit evidence", "hours spent per audit"),
    ],
    flaws: [
      f("subtitle", "alignment", "Indented from the title’s left edge.", { dx: 28 }),
      f("header.current", "font", "Set in Geist; the column headings are Geist Mono.", { font: "geist" }),
      f("current.0.sub", "spelling", "“Vulnerabilites” should be “Vulnerabilities”.", {
        text: "Vulnerabilites found when they cost most to fix",
      }),
      f("current.1.head", "leftover", "A yellow highlight left over from an edit.", { highlight: true }),
      f("current.2.sub", "punctuation", "“cant” is missing its apostrophe.", { text: "Developers ignore alerts they cant act on" }),
      f("current.3.icon", "icon", "A green tick on a current-state problem.", { icon: "check" }),
      f("future.0.head", "grammar", "“Scans runs” should be “Scans run”.", { text: "Scans runs on every pull request" }),
      f("future.2.head", "font", "Set in Comic Sans instead of Geist.", { font: "comic" }),
      f("future.3.head", "consistency", "British “artefact” here, American “artifacts” below.", {
        text: "SBOM generated for every artefact",
      }),
      f("future.4.sub", "style", "Not italic, unlike the other outcome lines.", { italic: false }),
      f("capability.1", "spacing", "This line sits lower than the even spacing of the others.", { dy: 9 }),
      f("capability.4", "capitalization", "“Hours” is capitalized; every other measure starts lower case.", {
        metric: "Hours spent per audit",
      }),
      f("divider", "alignment", "The column divider is off-center, so the arrow no longer sits on it.", { dx: 40 }),
    ],
  },
  {
    id: "cloud-cost",
    subtitle: "Confirming your priorities re: Cloud Cost Management",
    current: [
      r("Cloud bill grows faster than revenue", "Finance asks questions engineering can’t answer"),
      r("Costs not mapped to teams or products", "No one owns the spend they create"),
      r("Idle resources run around the clock", "Paying for capacity nobody uses"),
      r("Commitments bought on gut feel", "Savings plans go underused"),
      r("Anomalies found when the invoice arrives", "Overruns caught a month too late"),
    ],
    future: [
      r("Spend tracked against business value", "Engineering and finance share one view"),
      r("Every dollar allocated to an owner", "Teams act on the costs they create"),
      r("Idle resources stopped automatically", "Pay only for what runs"),
      r("Commitments sized by actual usage", "Savings plans fully used"),
      r("Anomalies flagged within hours", "Overruns stopped before they grow"),
    ],
    capabilities: [
      c("Cost perspectives and business mapping", "% of spend allocated"),
      c("AutoStopping rules for non-production", "idle hours eliminated"),
      c("Commitment orchestration", "commitment utilization %"),
      c("Anomaly detection with alerts", "time to detect an anomaly"),
    ],
    flaws: [
      f("title", "size", "The title is larger than the template’s.", { size: 52 }),
      f("logo", "alignment", "The logo has moved in from the right margin and down from the title line.", { dx: -40, dy: 18 }),
      f("header.current", "alignment", "Sits lower than the “Future state” heading beside it.", { dy: 9 }),
      f("current.0.sub", "grammar", "“Finance ask” should be “Finance asks”.", { text: "Finance ask questions engineering can’t answer" }),
      f("current.1.head", "alignment", "Indented from the column’s left edge.", { dx: 22 }),
      f("current.2.sub", "spelling", "“no body” should be “nobody”.", { text: "Paying for capacity no body uses" }),
      f("current.4.head", "grammar", "The word “the” appears twice.", { text: "Anomalies found when the the invoice arrives" }),
      f("future.1.head", "grammar", "“a owner” should be “an owner”.", { text: "Every dollar allocated to a owner" }),
      f("future.2.icon", "icon", "A red cross on a future-state outcome; it should be the tick.", { icon: "cross" }),
      f("future.3.sub", "leftover", "Underlined in blue like a stray hyperlink.", { underline: true, color: "#2563eb" }),
      f("future.4.head", "color", "Orange where every other headline is black.", { color: "#c2410c" }),
      f("capability.2", "consistency", "British “utilisation” on a slide written in American English.", {
        metric: "commitment utilisation %",
      }),
      f("capability.3", "font", "Set in Courier New instead of Geist.", { font: "courier" }),
    ],
  },
  {
    id: "feature-management",
    subtitle: "Confirming your priorities re: Feature Management & Experimentation",
    current: [
      r("Releases tied to deployments", "Every launch is a high-stakes event"),
      r("Rollbacks require a full redeploy", "Bad releases stay live for hours"),
      r("Feature impact measured weeks later", "Teams guess which changes moved the numbers"),
      r("Flags managed in config files", "Stale flags pile up as tech debt"),
      r("No safe way to test in production", "Customers find the bugs first"),
    ],
    future: [
      r("Releases decoupled from deployments", "Launch when the business is ready"),
      r("Kill switch for every feature", "Bad releases turned off in seconds"),
      r("Impact measured on every release", "Decisions backed by data"),
      r("Flags governed in one place", "Stale flags cleaned up automatically"),
      r("Progressive rollouts by audience", "Issues caught with 1% of users"),
    ],
    capabilities: [
      c("Feature flags with targeting rules", "# of deployments per release"),
      c("Automated kill switches with monitoring", "time to disable a bad feature"),
      c("Release impact metrics", "% of releases with measured impact"),
      c("Flag lifecycle management", "# of stale flags"),
      c("Progressive delivery by percentage", "% of incidents caught before full rollout"),
    ],
    flaws: [
      f("title", "punctuation", "The ellipsis is missing from the title.", { text: "Our understanding" }),
      f("subtitle", "spelling", "“Managment” should be “Management”.", {
        text: "Confirming your priorities re: Feature Managment & Experimentation",
      }),
      f("current.0.head", "style", "Bold, where the other headlines are medium weight.", { weight: 800 }),
      f("current.1.sub", "size", "Larger than the other outcome lines.", { size: 16.5 }),
      f("current.3.icon", "alignment", "This cross sits left of the others.", { dx: -12 }),
      f("current.4.sub", "grammar", "“Customers finds” should be “Customers find”.", { text: "Customers finds the bugs first" }),
      f("future.2.head", "capitalization", "“Release” is capitalized mid-sentence.", { text: "Impact measured on every Release" }),
      f("future.3.sub", "font", "Set in Courier New instead of Geist.", { font: "courier" }),
      f("future.4.sub", "spacing", "Spaces between “1” and “%”.", { text: "Issues caught with 1   % of users" }),
      f("capability.0", "consistency", "A hollow bullet where the others are solid.", { bullet: "○" }),
      f("capability.3", "consistency", "No measure: every other capability says how it will be tracked.", { metric: "" }),
      f("arrow", "icon", "The arrow points back from the future state to the current one.", { pointLeft: true }),
      f("extra", "leftover", "A sticky note from a review was never deleted.", {}, {
        text: "TODO: check metric w/ Priya",
        x: 1010,
        y: 300,
        style: "sticky",
      }),
    ],
  },
  {
    id: "resilience",
    subtitle: "Confirming your priorities re: Resilience Testing & Incident Response",
    current: [
      r("Outages discovered by customers", "Revenue lost before anyone is paged"),
      r("Failover never tested end to end", "Disaster recovery plans exist only on paper"),
      r("Incident response depends on heroes", "The same few engineers are always on call"),
      r("Postmortems repeat the same causes", "Lessons learned are not acted on"),
      r("Reliability targets set but not tracked", "No one knows if SLOs are being met"),
    ],
    future: [
      r("Weaknesses found before customers do", "Revenue protected during peak traffic"),
      r("Failover tested on every release", "Recovery plans proven in practice"),
      r("Runbooks automated with AI assistance", "Any engineer can resolve an incident"),
      r("Fixes verified with repeatable experiments", "Causes stay fixed"),
      r("SLOs tracked against every change", "Releases gated on reliability"),
    ],
    capabilities: [
      c("Chaos experiments in every pipeline", "# of customer-found incidents"),
      c("Disaster recovery testing", "% of recovery time objectives met"),
      c("AI-assisted incident response", "mean time to resolve"),
      c("SLO-based release verification", "% of releases within error budget"),
    ],
    flaws: [
      f("headerIcon.future", "icon", "This heading’s icon is bigger than the one beside it.", { scale: 1.7 }),
      f("current.0.head", "spelling", "“costumers” should be “customers”.", { text: "Outages discovered by costumers" }),
      f("current.1.sub", "spacing", "Crowds its headline: the gap is smaller than in the other rows.", { dy: -7 }),
      f("current.2.sub", "punctuation", "“engineer’s” is a plural, so it takes no apostrophe.", {
        text: "The same few engineer’s are always on call",
      }),
      f("current.3.head", "font", "Set in Verdana instead of Geist.", { font: "verdana" }),
      f("current.4.head", "layout", "Too long for its column: it runs across the divider into the future state.", {
        text: "Reliability targets are set by leadership every quarter but are never actually tracked",
      }),
      f("future.0.sub", "spelling", "“trafic” should be “traffic”.", { text: "Revenue protected during peak trafic" }),
      f("future.1.icon", "icon", "This tick is smaller than the others.", { scale: 0.45 }),
      f("future.2.head", "capitalization", "“Ai” should be “AI”.", { text: "Runbooks automated with Ai assistance" }),
      f("future.3.sub", "capitalization", "Starts with a lower-case letter.", { text: "causes stay fixed" }),
      f("future.4.head", "spacing", "This row sits lower than the even spacing of the others.", { dy: 10 }),
      f("capabilitiesTitle", "font", "Set in Georgia; the box heading is Geist Mono, like the column headings.", { font: "georgia" }),
      f("capability.1", "color", "So pale it is hard to read.", { color: "#d4d4d0" }),
    ],
  },
  {
    id: "developer-portal",
    subtitle: "Confirming your priorities re: Internal Developer Portal & Platform Engineering",
    current: [
      r("New engineers take weeks to ship", "Onboarding depends on tribal knowledge"),
      r("Service ownership unclear", "Incidents bounce between teams"),
      r("Every team builds its own scaffolding", "Standards drift from day one"),
      r("Tickets needed for every environment", "Developers wait days for infrastructure"),
      r("Docs scattered across wikis", "Answers are hard to find and often wrong"),
    ],
    future: [
      r("New engineers ship in their first week", "Onboarding is self-service"),
      r("Every service has a clear owner", "Incidents routed to the right team"),
      r("Golden-path templates for new services", "Standards built in from day one"),
      r("Self-service environments on demand", "Infrastructure in minutes, not days"),
      r("One catalog for docs and APIs", "Answers in one place, always current"),
    ],
    capabilities: [
      c("Software catalog with ownership", "% of services with an owner"),
      c("Scaffolding templates and golden paths", "time to first deployment"),
      c("Self-service workflows with guardrails", "# of infrastructure tickets"),
      c("Scorecards for production readiness", "% of services meeting standards"),
      c("TechDocs alongside the code", "developer satisfaction score"),
    ],
    flaws: [
      f("title", "alignment", "Indented from the slide’s left margin.", { dx: 24 }),
      f("subtitle", "size", "Larger than the template’s subtitle.", { size: 22 }),
      f("current.0.sub", "spelling", "“knowlege” should be “knowledge”.", { text: "Onboarding depends on tribal knowlege" }),
      f("current.1.head", "font", "Set in Times New Roman instead of Geist.", { font: "times" }),
      f("current.2.head", "grammar", "“it’s” means “it is”; this should be “its”.", { text: "Every team builds it’s own scaffolding" }),
      f("current.3.icon", "icon", "A green tick on a current-state problem.", { icon: "check" }),
      f("current.4.sub", "leftover", "A yellow highlight left over from an edit.", { highlight: true }),
      f("future.0.head", "grammar", "“there” should be “their”.", { text: "New engineers ship in there first week" }),
      f("future.3.sub", "spelling", "“Infrastucture” is missing an “r”.", { text: "Infrastucture in minutes, not days" }),
      f("future.4.head", "size", "Smaller than the other headlines.", { size: 12.5 }),
      f("capability.1", "alignment", "Indented further than the other capabilities.", { dx: 18 }),
      f("capability.4", "style", "Italic, unlike the other capabilities.", { italic: true }),
      f("capabilitiesBox", "alignment", "The box is shifted right, past the slide’s right margin.", { dx: 30 }),
    ],
  },
  {
    id: "infrastructure-as-code",
    subtitle: "Confirming your priorities re: Infrastructure as Code & GitOps",
    current: [
      r("Terraform run from laptops", "No record of who changed what"),
      r("Drift between environments", "Staging never matches production"),
      r("State files stored in shared buckets", "One mistake can corrupt everything"),
      r("Cost of changes unknown until the bill", "Surprise spend after every rollout"),
      r("Policy checks done in review meetings", "Approvals take days"),
    ],
    future: [
      r("Every change runs through a pipeline", "Full audit trail for every apply"),
      r("Drift detected and reconciled automatically", "Environments stay in sync"),
      r("State managed and locked centrally", "Safe, concurrent changes"),
      r("Cost estimated before every apply", "No surprises on the bill"),
      r("Policy enforced as code", "Approvals in minutes, not days"),
    ],
    capabilities: [
      c("Infrastructure as Code Management", "% of changes through a pipeline"),
      c("Drift detection and GitOps sync", "# of drift incidents"),
      c("Remote state with locking", "# of state-related failures"),
      c("Cost estimation in pull requests", "% of changes with a cost estimate"),
      c("OPA policies on every plan", "approval lead time"),
    ],
    flaws: [
      f("title", "spelling", "“understandng” is missing an “i”.", { text: "Our understandng…" }),
      f("header.future", "font", "Set in Geist; the column headings are Geist Mono.", { font: "geist" }),
      f("current.0.head", "grammar", "“ran” should be “run”: the slide describes how things are today.", {
        text: "Terraform ran from laptops",
      }),
      f("current.1.sub", "style", "Not italic, unlike the other outcome lines.", { italic: false }),
      f("current.2.head", "spacing", "This row sits higher than the even spacing of the others.", { dy: -9 }),
      f("current.3.sub", "color", "Red text where every other line is black.", { color: "#dc2626" }),
      f("future.0.icon", "alignment", "This tick sits right of the others.", { dx: 14 }),
      f("future.1.head", "layout", "Too long for its column: it runs past the slide’s right margin.", {
        text: "Drift is detected across every single environment and then reconciled automatically by GitOps",
      }),
      f("future.2.sub", "spacing", "A space before the comma.", { text: "Safe  ,  concurrent changes" }),
      f("future.4.sub", "size", "Smaller than the other outcome lines.", { size: 10 }),
      f("capability.2", "spelling", "“lockin” should be “locking”.", { text: "Remote state with lockin" }),
      f("capability.3", "font", "Set in Comic Sans instead of Geist.", { font: "comic" }),
      f("arrow", "size", "The arrow is bigger than the template’s.", { scale: 1.8 }),
      f("extra", "leftover", "A “[Customer logo]” placeholder was never filled in or removed.", {}, {
        text: "[Customer logo]",
        x: 900,
        y: 66,
        style: "placeholder",
      }),
    ],
  },
  {
    id: "database-devops",
    subtitle: "Confirming your priorities re: Database DevOps",
    current: [
      r("Schema changes applied by hand", "Releases wait on a DBA’s calendar"),
      r("Database changes not versioned", "No way to see what changed or when"),
      r("Rollbacks require a restore from backup", "A bad migration means hours of downtime"),
      r("App and database released separately", "Deployments fail on schema mismatches"),
      r("No checks before changes reach production", "Risky SQL found after the outage"),
    ],
    future: [
      r("Schema changes delivered through pipelines", "Releases ship on the team’s schedule"),
      r("Every database change in Git", "Full history of what changed and why"),
      r("Automatic rollback for every migration", "Recover in minutes, not hours"),
      r("App and schema released together", "No more mismatched deployments"),
      r("Policies check SQL before it runs", "Risky changes blocked early"),
    ],
    capabilities: [
      c("Database DevOps in the same pipeline", "% of schema changes automated"),
      c("Changelogs versioned in Git", "% of changes with an audit trail"),
      c("Rollback with every changeset", "mean time to recover"),
      c("Policy checks on every change", "# of failed migrations"),
    ],
    flaws: [
      f("subtitle", "capitalization", "The product is “DevOps”, not “Devops”.", { text: "Confirming your priorities re: Database Devops" }),
      f("logo", "layout", "The Harness logo is squashed out of proportion.", { stretch: 0.6 }),
      f("headerIcon.future", "icon", "Both headings carry a cross; future state should have the green tick.", { icon: "cross" }),
      f("current.0.head", "style", "Italic, unlike the other headlines.", { italic: true }),
      f("current.0.sub", "grammar", "“Releases waits” should be “Releases wait”.", { text: "Releases waits on a DBA’s calendar" }),
      f("current.2.sub", "spelling", "“down time” should be one word, “downtime”.", {
        text: "A bad migration means hours of down time",
      }),
      f("current.4.icon", "icon", "This cross is bigger than the others.", { scale: 2 }),
      f("future.0.sub", "alignment", "Indented further than the other outcome lines.", { dx: 18 }),
      f("future.1.head", "capitalization", "“GIT” should be “Git”, as it is in the capabilities.", { text: "Every database change in GIT" }),
      f("future.2.head", "font", "Set in Verdana instead of Geist.", { font: "verdana" }),
      f("future.4.head", "grammar", "“it run” should be “it runs”.", { text: "Policies check SQL before it run" }),
      f("capabilitiesTitle", "alignment", "Indented from the capabilities below it.", { dx: 22 }),
      f("capability.1", "size", "Larger than the other capabilities.", { size: 17.5 }),
      f("capability.3", "spelling", "“migratoins” should be “migrations”.", { metric: "# of failed migratoins" }),
    ],
  },
];

/** Every piece of a finished slide that can be clicked. */
export function targetsOf(slide: Slide): Target[] {
  const rows = (side: Side) =>
    ([0, 1, 2, 3, 4] as const).flatMap((i) => (["head", "sub", "icon"] as const).map((part): Target => `${side}.${i}.${part}`));
  return [
    "title",
    "subtitle",
    "logo",
    "header.current",
    "header.future",
    "headerIcon.current",
    "headerIcon.future",
    ...rows("current"),
    ...rows("future"),
    "capabilitiesTitle",
    ...slide.capabilities.map((_, i): Target => `capability.${i}`),
    "capabilitiesBox",
    "arrow",
    "divider",
  ];
}

export const MAX_SCORE = SLIDES.reduce((sum, s) => sum + s.flaws.length * POINTS.found, 0);

export type SlideResult = { found: number; wrongClicks: number; missed: number };

export const pointsFor = (r: SlideResult) =>
  r.found * POINTS.found + r.wrongClicks * POINTS.wrongClick + r.missed * POINTS.missed;

export type Verdict = { from: number; title: string; verdict: string };

/** Read top down: the first whose `from` the share of the maximum reaches. */
export const VERDICTS: Verdict[] = [
  { from: 0.9, title: "Ready for the customer", verdict: "Hardly anything got past you. These slides would go out crisp and clean." },
  { from: 0.7, title: "Nearly there", verdict: "You caught most of it. Slow down on the last pass: the small things are what a customer notices." },
  {
    from: 0.4,
    title: "Needs another pass",
    verdict: "Plenty slipped through. Read each line on its own, then look down every column edge.",
  },
  {
    from: -Infinity,
    title: "Not ready to send",
    verdict: "Too many issues got through, or too many good parts were clicked. Review one kind of problem at a time.",
  },
];

export const verdictFor = (total: number) => VERDICTS.find((v) => total >= v.from * MAX_SCORE)!;
