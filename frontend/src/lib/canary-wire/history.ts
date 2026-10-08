/**
 * Reporting → Canary Wire History: each rep's completion month over month.
 *
 * Built by running the month view (`view.ts`) once per month and lining the
 * results up, so a month here can never disagree with the same month on the
 * Canary Wire tab: the same lineups, the same exemptions, the same people.
 */

import { contentMonths, monthView, rate, type Rep } from "@/lib/canary-wire/view";
import type { Accountability } from "@/lib/canary-wire/exemptions";
import { byMonth, monthKey } from "@/lib/canary-wire/months";
import { HISTORY_FIRST_MONTH, SERIES_LINKS, type SeriesLink } from "@/lib/canary-wire/config";
import { COMPLETED, norm, type CanaryWireSnapshot } from "@/lib/canary-wire/snapshot";

/** How many months the history shows. */
export const HISTORY_MONTHS = 6;

/** One rep in one month: the share of their own lineup they finished, or null when they owed nothing. */
export type MonthMark = {
  pct: number | null;
  completed: number;
  assigned: number;
  /** Not accountable yet that month: pre-bootcamp, or an SDR before their first full month. */
  exempt: boolean;
};

/** Of a group's learners who owed something in a month, how many finished everything. */
export type MonthRate = { learners: number; finished: number; pct: number | null };

export type HistoryRep = Pick<Rep, "name" | "email" | "role" | "manager" | "managerEmail" | "title" | "notActivated"> & {
  /** By month, in the order of `months`. */
  marks: MonthMark[];
};

export type HistoryTeam = { manager: string; managerEmail: string; roles: string[]; directs: HistoryRep[]; rates: MonthRate[] };

export type HistoryRole = { role: string; rates: MonthRate[] };

export type CanaryWireHistory = {
  /** Oldest first, as `historyMonths` chooses them. */
  months: string[];
  scope: "everyone" | "org";
  hasSnapshot: boolean;
  teams: HistoryTeam[];
  roles: HistoryRole[];
  /** Everyone shown, month by month. */
  totals: MonthRate[];
  seriesLinks: SeriesLink[];
};

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The months the history covers: the last `HISTORY_MONTHS` with content from
 * `HISTORY_FIRST_MONTH`, a month nobody published for (August 2026) skipped.
 *
 * No month before its time: content is often published ahead, so October's
 * modules can be live in late September. A month shows once the calendar has
 * reached it (`current`, "October 2026") and someone has finished one of its
 * modules — on the 1st, before anyone has, last month is still the newest.
 * Over the whole pull, not a manager's org, so every viewer sees one set of
 * months.
 */
export function historyMonths(snap: CanaryWireSnapshot, current: string): string[] {
  const finishedIn = new Set<string>();
  const monthOfModule = new Map(snap.modules.map((m) => [m.module_id, m.month]));
  for (const states of Object.values(snap.progress)) {
    for (const [mid, entry] of Object.entries(states)) {
      const month = monthOfModule.get(mid);
      if (month && norm(entry.state) === norm(COMPLETED)) finishedIn.add(month);
    }
  }
  return contentMonths(snap)
    .filter((m) => monthKey(m) >= monthKey(HISTORY_FIRST_MONTH) && monthKey(m) <= monthKey(current))
    .filter((m) => monthKey(m) < monthKey(current) || finishedIn.has(m))
    .sort(byMonth)
    .slice(-HISTORY_MONTHS);
}

function rateOf(marks: MonthMark[]): MonthRate {
  const owing = marks.filter((m) => !m.exempt && m.assigned > 0);
  const finished = owing.filter((m) => m.completed >= m.assigned).length;
  return { learners: owing.length, finished, pct: rate(finished, owing.length) };
}

/** Each month's rate over `reps`, month by month. */
function ratesOver(reps: HistoryRep[], months: number): MonthRate[] {
  return Array.from({ length: months }, (_, i) => rateOf(reps.map((r) => r.marks[i]!)));
}

/**
 * Best first, newest month first: by the latest month, then the one before
 * where that ties, and so on back. Early in a month nearly everyone is at 0%
 * in it, so the month before decides until this one fills in. No rate at all
 * sorts last.
 */
function byNewest(a: (number | null)[], b: (number | null)[]): number {
  for (let i = a.length - 1; i >= 0; i--) {
    const d = (b[i] ?? -1) - (a[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

export function historyView(
  snap: CanaryWireSnapshot,
  months: string[],
  standing: Accountability,
  orgManagers: Set<string> = new Set(),
): Omit<CanaryWireHistory, "scope"> {
  const views = months.map((m) => monthView(snap, m, standing, null, orgManagers));
  // Who people are comes from the newest month: the roster is the same in
  // every month — it is today's — and so are names and reporting lines.
  const people = new Map<string, HistoryRep>();
  views.forEach((v, i) => {
    for (const team of v.teams) {
      for (const d of team.directs) {
        const rep = people.get(d.email) ?? {
          name: d.name,
          email: d.email,
          role: d.role,
          manager: d.manager,
          managerEmail: d.managerEmail,
          title: d.title,
          notActivated: d.notActivated,
          marks: months.map(() => ({ pct: null, completed: 0, assigned: 0, exempt: false })),
        };
        rep.marks[i] = { pct: d.exempt ? null : d.pct, completed: d.completed, assigned: d.assigned, exempt: d.exempt };
        people.set(d.email, rep);
      }
    }
  });

  const reps = [...people.values()];
  const byLatest = (a: HistoryRep, b: HistoryRep) =>
    byNewest(
      a.marks.map((m) => m.pct),
      b.marks.map((m) => m.pct),
    ) || cmp(a.name, b.name);

  const teams: HistoryTeam[] = [...new Set(reps.map((r) => r.manager))].map((manager) => {
    const directs = reps.filter((r) => r.manager === manager).sort(byLatest);
    return {
      manager,
      managerEmail: directs.find((d) => d.managerEmail)?.managerEmail ?? "",
      roles: [...new Set(directs.map((d) => d.role))].sort(cmp),
      directs,
      rates: ratesOver(directs, months.length),
    };
  });
  teams.sort(
    (a, b) =>
      byNewest(
        a.rates.map((r) => r.pct),
        b.rates.map((r) => r.pct),
      ) || cmp(a.manager, b.manager),
  );

  const roles: HistoryRole[] = [...new Set(reps.map((r) => r.role))]
    .sort(cmp)
    .map((role) => ({ role, rates: ratesOver(reps.filter((r) => r.role === role), months.length) }));

  return { months, hasSnapshot: true, teams, roles, totals: ratesOver(reps, months.length), seriesLinks: SERIES_LINKS };
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** One row per rep, a column per month: the share of their lineup they finished, blank when they owed nothing. */
export function historyCsv(h: CanaryWireHistory): string {
  const rows = [["Name", "Email", "Role", "Manager", "Manager Email", ...h.months.map((m) => `${m} %`)]];
  for (const team of h.teams) {
    for (const r of team.directs) {
      rows.push([r.name, r.email, r.role, r.manager, r.managerEmail, ...r.marks.map((m) => (m.pct === null ? "" : m.pct.toFixed(1)))]);
    }
  }
  return rows.map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}
