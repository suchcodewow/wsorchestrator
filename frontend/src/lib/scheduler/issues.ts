/**
 * What is wrong with a schedule: the issues the schedule page lists under its
 * warning button, and the Welcome page counts for the active bootcamp. Pure,
 * so the schedule page recomputes them as a session is dragged.
 */

import { AUDIENCE_TRACKS, SCHEDULE_LIMITS, SCHEDULE_TRACKS } from "@/db/schema";
import type { ClassLists } from "@/lib/scheduler/attendees";
import type { Instructor, Schedule, SessionRow } from "@/lib/scheduler/schedule";
import { GROUP_NAMES, findClashes, formatClock, place, stageOf, type Clash, type Placed } from "@/lib/scheduler/timeline";

/** Where a session is, for naming it and going to it. */
export type Spot = Omit<Clash, "what">;

/** Something wrong with the schedule: a sentence that starts with `lead` and names the sessions it is about. */
export type Issue = { kind: IssueKind; key: string; lead: string; spots: Spot[] };

type IssueKind = "clash" | "leader" | "outsider" | "late" | "breakout";

/** How many of each kind there are, for the top of the tooltip: "3 clashes · 12 with nobody leading". */
export function tally(issues: Issue[]): string {
  const count = (k: IssueKind) => issues.filter((i) => i.kind === k).length;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const clashes = count("clash");
  const leaders = count("leader");
  const outsiders = count("outsider");
  const late = count("late");
  const breakouts = count("breakout");
  return [
    clashes > 0 && plural(clashes, "clash", "clashes"),
    leaders > 0 && `${leaders} with nobody leading`,
    outsiders > 0 && `${plural(outsiders, "person", "people")} not an administrator or guest judge`,
    late > 0 && `${late} ending after ${formatClock(SCHEDULE_LIMITS.dayEnd)}`,
    breakouts > 0 && `${plural(breakouts, "breakout", "breakouts")} not fully assigned`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Everything wrong with the schedule, in the order it happens: each pair of
 * sessions that clash (once), each main or breakout session nobody leads,
 * each person on a session who is not a Training administrator or a guest
 * judge of this bootcamp (once, with all their sessions; a copied schedule
 * can bring them in), each session that ends after the day does, and each
 * breakout that leaves
 * someone in its class out of every group, has no assessment to score them on,
 * or, when the facility has rooms, leaves an instructor without one. `flagged` has what is wrong with each session, by
 * id, for its card.
 */
export function findIssues(
  placed: Placed<SessionRow>[],
  clashes: Map<string, Clash[]>,
  roomNames: Map<string, string>,
  classes: ClassLists,
  hasRooms: boolean,
  instructors: Instructor[],
) {
  const { dayEnd } = SCHEDULE_LIMITS;
  const spotOf = (s: Placed<SessionRow>): Spot => ({ sessionId: s.id, name: s.name, track: s.track, day: s.day, start: s.start, end: s.end });
  const nameOf = (what: Clash["what"]) =>
    what.kind === "person" ? what.fullName : what.kind === "room" ? (roomNames.get(what.roomId) ?? "A room") : GROUP_NAMES[what.group];
  const verb = (what: Clash["what"]) => (what.kind === "audience" ? "are" : "is");
  const issues: Issue[] = [];
  const flagged = new Map<string, string[]>();
  const flag = (id: string, why: string) => flagged.set(id, [...(flagged.get(id) ?? []), why]);
  const pool = new Set(instructors.map((i) => i.email.toLowerCase()));
  const outsiders = new Map<string, { fullName: string; spots: Spot[] }>();

  for (const s of placed) {
    for (const c of clashes.get(s.id) ?? []) {
      flag(s.id, `${nameOf(c.what)} ${verb(c.what)} also in ${c.name}`);
      if (s.id > c.sessionId) continue;
      const whatKey = c.what.kind === "person" ? c.what.email : c.what.kind === "room" ? c.what.roomId : c.what.group;
      issues.push({ kind: "clash", key: `clash:${s.id}:${c.sessionId}:${whatKey}`, lead: `${nameOf(c.what)} ${verb(c.what)} in both`, spots: [spotOf(s), c] });
    }
    if (s.kind !== "unstructured" && s.staff.length === 0) {
      flag(s.id, "Nobody leads it");
      issues.push({ kind: "leader", key: `leader:${s.id}`, lead: "Nobody leads", spots: [spotOf(s)] });
    }
    for (const p of s.staff) {
      const email = p.email.toLowerCase();
      if (pool.has(email)) continue;
      flag(s.id, `${p.fullName} is not an administrator or guest judge here`);
      const o = outsiders.get(email) ?? { fullName: p.fullName, spots: [] };
      o.spots.push(spotOf(s));
      outsiders.set(email, o);
    }
    if (s.end > dayEnd) {
      flag(s.id, `Ends after ${formatClock(dayEnd)}`);
      issues.push({ kind: "late", key: `late:${s.id}`, lead: `Ends after ${formatClock(dayEnd)}:`, spots: [spotOf(s)] });
    }
    if (s.kind === "breakout") {
      const assigned = new Set(s.assigned);
      const unassigned = AUDIENCE_TRACKS[s.audience].flatMap((t) => classes[stageOf(s.track)][t]).filter((e) => !assigned.has(e)).length;
      const roomless = hasRooms ? s.staff.filter((p) => !p.roomId).length : 0;
      const gaps = [
        unassigned > 0 && `${unassigned} ${unassigned === 1 ? "attendee" : "attendees"} not assigned`,
        roomless > 0 && `${roomless} ${roomless === 1 ? "instructor" : "instructors"} without a room`,
        !s.assessmentId && "no assessment",
      ].filter((g): g is string => Boolean(g));
      const upper = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
      for (const g of gaps) flag(s.id, upper(g));
      if (gaps.length > 0) issues.push({ kind: "breakout", key: `breakout:${s.id}`, lead: `${upper(gaps.join(" and "))}:`, spots: [spotOf(s)] });
    }
  }
  const bySpot = (x: Spot, y: Spot) => x.day - y.day || x.start - y.start;
  for (const [email, o] of outsiders) {
    issues.push({
      kind: "outsider",
      key: `outsider:${email}`,
      lead: `${o.fullName} is not an administrator or guest judge here:`,
      spots: o.spots.sort(bySpot),
    });
  }
  const first = (i: Issue) => i.spots[0]!;
  issues.sort((x, y) => bySpot(first(x), first(y)));
  return { issues, flagged };
}

/** The issues in a schedule as it was loaded, as its page first shows them. */
export function scheduleIssues(schedule: Schedule): Issue[] {
  const placed = place(SCHEDULE_TRACKS.flatMap((t) => schedule.days[t]));
  const roomNames = new Map(schedule.rooms.map((r) => [r.id, r.name]));
  return findIssues(placed, findClashes(placed), roomNames, schedule.classes, schedule.rooms.length > 0, schedule.instructors).issues;
}
