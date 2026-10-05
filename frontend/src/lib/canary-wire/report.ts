/**
 * What the Canary Wire page derives from a square, shared by the heat map and
 * the Slack paste so the two can't disagree about a rep: its colour, its link
 * into Mindtickle, and when it happened.
 */

import type { SeriesLink } from "@/lib/canary-wire/config";
import type { Cell, Rep, Team } from "@/lib/canary-wire/view";

export type StateClass = "completed" | "progress" | "notstarted" | "blank";

export function stateClass(state: string | null | undefined): StateClass {
  const s = (state ?? "").toLowerCase();
  if (s.includes("complete")) return "completed";
  if (s.includes("progress")) return "progress";
  if (s.includes("not started")) return "notstarted";
  return "blank";
}

/**
 * The legend's colours as emoji, for the Slack paste. Unicode rather than
 * Slack's `:green_circle:`, which is a circle only inside Slack and literal
 * colons once the text is forwarded into email or a doc.
 */
export const STATE_DOT: Partial<Record<StateClass, string>> = {
  completed: "\u{1F7E2}",
  progress: "\u{1F7E1}",
  notstarted: "\u{1F534}",
};

/**
 * When something happened, for a square's tooltip. For a finished module the
 * stamp is the completion; for unfinished work it is only the last thing
 * Mindtickle logged, and says so, so "In Progress 11:29 AM" isn't read as a
 * finish time.
 */
export function when(cell: Pick<Cell, "state" | "atPt" | "on">): string {
  const done = stateClass(cell.state) === "completed";
  if (cell.atPt) return done ? ` ${cell.atPt}` : ` — last activity ${cell.atPt}`;
  if (!cell.on) return "";
  return done ? ` on ${cell.on}` : ` — last activity ${cell.on}`;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The day alone, "Oct 1, 2026", for the Slack paste: a manager reads down a
 * column of names, and a clock time on every line gets in the way. Cut from
 * the formatted Pacific stamp rather than re-parsed, so it can't land on a
 * different day than the tooltip; a bare `on` is built by hand, because
 * `new Date("2026-10-01")` is midnight UTC and the evening before in Pacific.
 */
export function dayOnly(cell: Pick<Cell, "atPt" | "on">): string {
  if (cell.atPt) {
    const cut = cell.atPt.indexOf(" at ");
    return cut === -1 ? cell.atPt : cell.atPt.slice(0, cut);
  }
  const iso = (cell.on || "").slice(0, 10);
  const hit = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const month = hit ? MONTHS_SHORT[Number(hit[2]) - 1] : undefined;
  return hit && month ? `${month} ${Number(hit[3])}, ${hit[1]}` : iso;
}

/**
 * A square's link into Mindtickle, or "" when there is no true one. An
 * off-role square gets none: its series is one this rep isn't enrolled in.
 * A pre-bootcamp square keeps its link, because the module is in their lineup.
 * `module_type` is a path segment Mindtickle wants lowercased, so anything but
 * a plain word drops the link rather than splicing something odd into a path;
 * and a template asking for a value we lack drops it too, rather than linking
 * to a literal "{series_id}".
 */
export function moduleUrl(cell: Cell | undefined, template: string): string {
  if (!template || !cell) return "";
  if (!cell.accountable && !cell.exempt) return "";
  const parts: Record<string, string> = {
    module_id: encodeURIComponent(cell.moduleId),
    series_id: encodeURIComponent(cell.seriesId),
    module_type: cell.moduleType.toLowerCase(),
  };
  if (parts.module_type && !/^[a-z0-9_-]+$/.test(parts.module_type)) return "";
  let out = template;
  for (const [key, value] of Object.entries(parts)) {
    const slot = `{${key}}`;
    if (!out.includes(slot)) continue;
    if (!value) return "";
    out = out.split(slot).join(value);
  }
  return out;
}

export function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const formatPct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(1)}%`);

/**
 * One manager's team as a report to paste into Slack, in both clipboard
 * flavours. Slack's `<url|label>` is honoured only for messages posted through
 * its API; a human's paste arrives as literal brackets. What the composer does
 * take is rich text, so the links ride in `html`, and `text` is for anywhere
 * plain, where each URL has to go on its own line to survive at all.
 *
 * No `*mrkdwn*` either, so it reads the same pasted into a DM, an email or a
 * doc. Takes the directs on screen rather than the whole team, so what is
 * copied is what is shown, and the title says when that is a subset.
 */
export function slackReport(
  team: Pick<Team, "manager" | "directs">,
  directs: Rep[],
  labels: string[],
  month: string,
  seriesLinks: SeriesLink[],
  template: string,
): { text: string; html: string } {
  const lines: string[] = [];
  const html: string[] = [];
  // HTML collapses runs of spaces, so the rich side indents with non-breaking ones.
  const IND = "&nbsp;&nbsp;";
  const push = (plain: string, rich: string) => {
    lines.push(plain);
    html.push(rich);
  };

  const roles = new Set(directs.map((d) => d.role).filter(Boolean));
  const series = seriesLinks.filter((s) => roles.has(s.edition));

  // The title is the series link, at the top, because the bottom of a pasted
  // list is where links go to be ignored. Only when one series covers
  // everyone listed: a team spanning two editions has no single right
  // destination, so its title stays plain and both are named underneath.
  const partial = directs.length !== team.directs.length;
  const title = `Canary Wire — ${month}`;
  const rest = ` — ${team.manager}` + (partial ? ` (${directs.length} of ${team.directs.length} shown)` : "");
  const one = series.length === 1 ? series[0]! : null;
  lines.push(title + rest);
  html.push(`<div><b>${one ? `<a href="${esc(one.url)}">${esc(title)}</a>` : esc(title)}${esc(rest)}</b></div>`);
  if (one) lines.push(one.url);
  if (!one) {
    for (const s of series) {
      const name = `${s.label} series`;
      lines.push(`${name}: ${s.url}`);
      html.push(`<div><a href="${esc(s.url)}">${esc(name)}</a></div>`);
    }
  }
  push("", "<div><br></div>");

  for (const d of directs) {
    const who = d.name || d.email;
    push(who, `<div>${esc(who)}</div>`);
    // Their own lineup only: a follow-up list that mixed in off-role or
    // pre-bootcamp work would invite chasing someone for what was never theirs.
    const owed = labels.filter((l) => d.cells[l]?.accountable);
    if (!owed.length) {
      const none = d.exempt ? "Pre-bootcamp — nothing owed this month" : "No modules assigned this month";
      push(`  • ${none}`, `<div>${IND}• ${esc(none)}</div>`);
    }
    for (const label of owed) {
      const cell = d.cells[label]!;
      const state = stateClass(cell.state);
      // Outside the link, so the circle isn't clickable text; and none at all
      // for a state we don't recognise, rather than a guessed colour.
      const dot = STATE_DOT[state] ? `${STATE_DOT[state]} ` : "";
      let tail = ` — ${cell.state}`;
      // Only a completion gets a date: for unfinished work it is just the last
      // thing logged, and "In Progress (Sep 28)" reads like a finish date.
      if (state === "completed") {
        const day = dayOnly(cell);
        if (day) tail += ` (${day})`;
      }
      const href = moduleUrl(cell, template);
      lines.push(`  • ${dot}${label}${tail}`);
      if (href) lines.push(`    ${href}`);
      html.push(`<div>${IND}• ${dot}${href ? `<a href="${esc(href)}">${esc(label)}</a>` : esc(label)}${esc(tail)}</div>`);
    }
    push("", "<div><br></div>");
  }

  const done = directs.reduce((n, d) => n + d.completed, 0);
  const assigned = directs.reduce((n, d) => n + d.assigned, 0);
  const total = assigned
    ? `Team total: ${done}/${assigned} (${((done / assigned) * 100).toFixed(1)}%)`
    : "Team total: nothing owed this month";
  push(total, `<div>${esc(total)}</div>`);
  return { text: lines.join("\n"), html: html.join("") };
}
