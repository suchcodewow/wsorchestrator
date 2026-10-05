/**
 * Reading Mindtickle's records into a Canary Wire pull: a module's month from
 * its name, a learner's manager from a profile with obfuscated keys, and a
 * module's state and moment from xAPI statements whose dates arrive divided
 * by 1000. Ported from canary-wire-reports' `rest.py` and `rest_report.py`,
 * where each of these was worked out against the live tenant.
 */

import type { ProgressEntry, SnapshotLearner } from "@/lib/canary-wire/snapshot";
import { COMPLETED, NOT_STARTED, norm } from "@/lib/canary-wire/snapshot";

export type MtRecord = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const obj = (v: unknown): MtRecord => (v && typeof v === "object" && !Array.isArray(v) ? (v as MtRecord) : {});

/** Every pattern appears in the name: for narrowing to one series. */
export const matchesAll = (name: string, patterns: string[]) => patterns.every((p) => norm(name).includes(norm(p)));
/** Any pattern appears in the name: for alternative spellings. */
export const matchesAny = (name: string, patterns: string[]) => patterns.some((p) => norm(name).includes(norm(p)));

const MONTH_PREFIX =
  /^\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\s*[-–—:]\s*(.+)$/i;

/** "September 2026 - Flex Pricing" → ["September 2026", "Flex Pricing"]; ["", name] without a prefix. */
export function splitMonth(name: string): [string, string] {
  const hit = MONTH_PREFIX.exec(name);
  if (!hit) return ["", name.trim()];
  const month = hit[1]!.charAt(0).toUpperCase() + hit[1]!.slice(1).toLowerCase();
  return [`${month} ${hit[2]}`, hit[3]!.trim()];
}

const STATE_ALIASES: Record<string, string> = {
  not_started: NOT_STARTED,
  notstarted: NOT_STARTED,
  in_progress: "In Progress",
  inprogress: "In Progress",
  completed: COMPLETED,
  complete: COMPLETED,
};

/** The progress state an xAPI statement's verb names. */
export function statementState(st: MtRecord): string {
  const verb = obj(st.verb);
  let raw = str(obj(verb.display)["en-US"]);
  if (!raw) raw = str(verb.id).replace(/\/+$/, "").split("/").pop() ?? "";
  const key = raw.trim().toLowerCase().replace(/[ -]/g, "_");
  return STATE_ALIASES[key] ?? (raw.trim() || "Unknown");
}

export const statementObjectId = (st: MtRecord) => str(obj(st.object).id);

// Mindtickle launched well after this, so an earlier moment is a misreading.
const PLAUSIBLE_FROM = Date.UTC(2015, 0, 1);

/**
 * When the event really happened, ISO UTC, or "" if there was none.
 *
 * Not `timestamp`: xAPI here synthesises statements from current state, so
 * every `timestamp` is the moment the request was served. `stored` carries the
 * event, but divided by 1000 — a September 2026 completion arrives as
 * 1970-01-21T16:58:13.076Z — so it is scaled back up, which leaves it good to
 * the second. A statement with no event repeats `timestamp` in `stored`, and
 * would otherwise claim to have happened just now.
 */
export function statementEventMoment(st: MtRecord, now = Date.now()): string {
  const raw = str(st.stored).trim();
  if (!raw || raw === str(st.timestamp).trim()) return "";
  const parsed = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`);
  if (Number.isNaN(parsed)) return "";
  for (const scale of [1, 1000]) {
    const ms = Math.round(parsed * scale);
    if (ms >= PLAUSIBLE_FROM && ms <= now + 86_400_000) return isoSeconds(ms);
  }
  return "";
}

/** `2026-09-11T02:29:20Z`, with a fraction only when there is one, as the tool wrote them. */
function isoSeconds(ms: number): string {
  const iso = new Date(ms).toISOString();
  const frac = ms % 1000;
  return frac ? `${iso.slice(0, 19)}.${String(frac).padStart(3, "0")}000Z` : `${iso.slice(0, 19)}Z`;
}

const RANK: Record<string, number> = { [norm(NOT_STARTED)]: 0, "in progress": 1, [norm(COMPLETED)]: 2 };
const rank = (e: ProgressEntry): [number, string] => [RANK[norm(e.state)] ?? 0, e.on];

/** One entry per module from a learner's statements: the furthest state, then the latest day. */
export function bestProgress(statements: MtRecord[], now = Date.now()): { best: Record<string, ProgressEntry>; newest: string } {
  const best: Record<string, ProgressEntry> = {};
  let newest = "";
  for (const st of statements) {
    const mid = statementObjectId(st);
    if (!mid) continue;
    const stamp = str(st.timestamp);
    if (stamp > newest) newest = stamp;
    const at = statementEventMoment(st, now);
    const entry = { state: statementState(st), on: at.slice(0, 10), at };
    const prior = best[mid];
    if (!prior) {
      best[mid] = entry;
      continue;
    }
    const [a, b] = [rank(entry), rank(prior)];
    // Ties go to the later statement.
    if (a[0] > b[0] || (a[0] === b[0] && a[1] >= b[1])) best[mid] = entry;
  }
  return { best, newest };
}

// Users.profile arrives with obfuscated keys. Confirmed against the live
// tenant: dp = department, dg = job title, a_0 = direct manager's name.
const PROFILE_KEYS: Record<string, string[]> = { title: ["dg", "title", "designation"], manager: ["a_0"] };

export function profileValue(user: MtRecord, key: string): string {
  const profile = user.profile;
  if (profile && typeof profile === "object" && !Array.isArray(profile)) {
    const p = profile as MtRecord;
    for (const candidate of PROFILE_KEYS[key] ?? [key]) {
      const v = p[candidate];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    for (const [k, v] of Object.entries(p)) {
      if (norm(k).replace(/_/g, " ") === norm(key) && typeof v === "string") return v;
    }
  }
  return typeof user[key] === "string" ? (user[key] as string) : "";
}

// managers[] carries the custom manager field (a_0, matching profile.a_0) and
// the org chart's. The custom one is the frontline manager Harness fills in.
const MANAGER_KEYS = ["a_0", "User_Manager"];

export function managerEmail(user: MtRecord): string {
  const byKey = new Map<string, string>();
  if (Array.isArray(user.managers)) {
    for (const m of user.managers) {
      const who = str(obj(m).email).trim();
      if (who) byKey.set(str(obj(m).key), who);
    }
  }
  for (const key of MANAGER_KEYS) if (byKey.get(key)) return byKey.get(key)!;
  return byKey.values().next().value ?? "";
}

/** Python's `str.title()`: a capital after anything that isn't a letter, so "o'hara" is "O'Hara". */
function title(s: string): string {
  return s.toLowerCase().replace(/(^|[^\p{L}])(\p{Ll})/gu, (_, before: string, c: string) => before + c.toUpperCase());
}

/**
 * One display name per manager, so a team isn't split in two: some learners
 * carry only the manager's email, others only the name in `profile.a_0`, and
 * Harness addresses are first.last@harness.io, which reduce to the same name.
 */
export function displayName(value: string): string {
  let v = value.trim();
  if (!v) return "";
  if (v.includes("@")) v = v.split("@", 1)[0]!.replace(/_/g, ".").split(".").filter(Boolean).join(" ");
  return title(v);
}

export function managerName(user: MtRecord): string {
  const email = managerEmail(user);
  // managers[] is empty for a fair number of learners whose profile names one.
  return displayName(email || profileValue(user, "manager"));
}

export function learnerFrom(user: MtRecord, edition: string): SnapshotLearner {
  return {
    email: str(user.email).trim(),
    name: str(user.name),
    role: edition,
    manager: managerName(user),
    manager_email: managerEmail(user),
    title: profileValue(user, "title"),
    state: str(user.userState).toUpperCase(),
  };
}
