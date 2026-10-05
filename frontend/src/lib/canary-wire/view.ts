/**
 * One Canary Wire month out of a pull: every rep's squares, their managers'
 * teams, the per-role rates and the totals. A port of canary-wire-reports'
 * `month_view`, so the numbers match the tool's for the same pull and the
 * same exemptions.
 */

import { COLUMN_ORDER, MODULE_URL_TEMPLATE, SERIES_LINKS, type SeriesLink } from "@/lib/canary-wire/config";
import type { Accountability, ExemptionSource } from "@/lib/canary-wire/exemptions";
import { FIRST_MONTH, LAST_MONTH, byMonth, monthRange, toPacific } from "@/lib/canary-wire/months";
import {
  COMPLETED,
  NOT_ACTIVATED,
  NOT_STARTED,
  monthsWithProgress,
  norm,
  type CanaryWireSnapshot,
  type ProgressEntry,
  type SnapshotModule,
} from "@/lib/canary-wire/snapshot";

export type OtherCopy = { state: string; on: string; atPt: string; edition: string };

export type Cell = {
  state: string;
  on: string;
  /** The moment in Pacific, "Sep 28, 2026 at 11:29 AM PDT", or "" when only a day is known. */
  atPt: string;
  moduleId: string;
  /** The series this square was reached through, so its link opens where this rep is assigned it. */
  seriesId: string;
  moduleType: string;
  /** In their own lineup and owed this month: counted in every rate. */
  accountable: boolean;
  /** In their lineup but they are pre-bootcamp: shown, not counted. */
  exempt: boolean;
  also: OtherCopy[];
  /** For off-role work, every edition that carries the module. */
  edition?: string;
};

export type Rep = {
  name: string;
  email: string;
  role: string;
  manager: string;
  managerEmail: string;
  title: string;
  /** Never activated Mindtickle, so "Not Started" everywhere is a different problem. */
  notActivated: boolean;
  /** Nobody reports to them, so their rate is the frontline rate. */
  ic: boolean;
  exempt: boolean;
  /** Their first accountable month, or "" — for the pre-bootcamp badge. */
  exemptFrom: string;
  exemptSource: ExemptionSource;
  cells: Record<string, Cell>;
  assigned: number;
  completed: number;
  pct: number | null;
  offRole: number;
};

export type Team = {
  manager: string;
  managerEmail: string;
  roles: string[];
  /** "Directs", not "reps": plenty of these managers manage managers. */
  directs: Rep[];
  learners: number;
  exempt: number;
  assigned: number;
  completed: number;
  pct: number | null;
  fullyComplete: number;
  notActivated: number;
};

export type RoleRow = {
  role: string;
  learners: number;
  exempt: number;
  assigned: number;
  completed: number;
  pct: number | null;
  icLearners: number;
  icAssigned: number;
  icCompleted: number;
  icPct: number | null;
  modules: string[];
};

export type Totals = {
  learners: number;
  exempt: number;
  rostered: number;
  assigned: number;
  completed: number;
  pct: number | null;
  icLearners: number;
  icAssigned: number;
  icCompleted: number;
  icPct: number | null;
  fullyComplete: number;
  notActivated: number;
};

export type LastActivity = { at: string; atPt: string; who: string; module: string; role: string };

export type CanaryWireView = {
  month: string;
  /** Every month the picker offers. */
  months: string[];
  /** Months with any content, for the picker's "(no data)" marks. */
  monthsWithData: string[];
  hasSnapshot: boolean;
  /** This month has modules. */
  hasData: boolean;
  labels: string[];
  modules: { label: string; edition: string; name: string }[];
  teams: Team[];
  roles: RoleRow[];
  totals: Totals | null;
  /** The newest completion in this month's content: a floor on how current the numbers are. */
  lastActivity: LastActivity;
  fetchedAtPt: string;
  savedAt: string | null;
  notes: string[];
  seriesLinks: SeriesLink[];
  moduleUrlTemplate: string;
};

/** A percentage to one place, or null when nothing is owed — which is not 0%. */
export function rate(done: number, assigned: number): number | null {
  return assigned ? Math.round((done / assigned) * 1000) / 10 : null;
}

// Plain code-point order, as the tool sorts, rather than locale order.
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const momentPt = (entry: Partial<ProgressEntry>) => toPacific(entry.at);

export function offeredMonths(snap: CanaryWireSnapshot | null): string[] {
  const offered = monthRange(FIRST_MONTH, LAST_MONTH);
  // Content outside the window still deserves to be selectable.
  const extra = contentMonths(snap).filter((m) => !offered.includes(m));
  return [...offered, ...extra].sort(byMonth);
}

export function contentMonths(snap: CanaryWireSnapshot | null): string[] {
  return snap ? [...new Set(snap.modules.map((m) => m.month).filter(Boolean))].sort(byMonth) : [];
}

/**
 * The month to open on: the newest one anybody has worked in. Not simply the
 * newest with content — on the 1st that is a month nobody has touched, and the
 * page opened on it looking broken.
 */
export function defaultMonth(snap: CanaryWireSnapshot | null): string {
  if (snap) {
    const live = [...monthsWithProgress(snap)].sort(byMonth);
    if (live.length) return live[live.length - 1]!;
  }
  const content = contentMonths(snap);
  if (content.length) return content[content.length - 1]!;
  const offered = offeredMonths(snap);
  return offered[offered.length - 1] ?? "";
}

function lastActivity(snap: CanaryWireSnapshot, labels: Map<string, string>): LastActivity {
  const learners = new Map(snap.learners.map((l) => [l.email, l]));
  let best: LastActivity = { at: "", atPt: "", who: "", module: "", role: "" };
  for (const [email, states] of Object.entries(snap.progress)) {
    const learner = learners.get(email);
    if (!learner) continue;
    for (const [mid, entry] of Object.entries(states)) {
      const label = labels.get(mid);
      if (!label || norm(entry.state) !== norm(COMPLETED)) continue;
      // Only full moments compete; a day alone would always lose anyway.
      if (entry.at.length > 10 && entry.at > best.at) {
        best = { at: entry.at, atPt: toPacific(entry.at), who: learner.name, module: label, role: learner.role };
      }
    }
  }
  return best;
}

/** A month's module labels in `COLUMN_ORDER`: AE's own, then AE and SE's shared, then SE's own. */
export function columnOrder(modules: Pick<SnapshotModule, "label" | "edition">[]): string[] {
  const editions = new Map<string, Set<string>>();
  for (const m of modules) editions.set(m.label, (editions.get(m.label) ?? new Set()).add(m.edition));
  const group = (label: string) => {
    const e = editions.get(label)!;
    const a = e.has(COLUMN_ORDER.first);
    const b = e.has(COLUMN_ORDER.second);
    return a && !b ? 0 : a && b ? 1 : b ? 2 : 3;
  };
  return [...editions.keys()].sort((x, y) => group(x) - group(y) || cmp(x, y));
}

export function emptyView(month: string): CanaryWireView {
  return {
    month,
    months: offeredMonths(null),
    monthsWithData: [],
    hasSnapshot: false,
    hasData: false,
    labels: [],
    modules: [],
    teams: [],
    roles: [],
    totals: null,
    lastActivity: { at: "", atPt: "", who: "", module: "", role: "" },
    fetchedAtPt: "",
    savedAt: null,
    notes: [],
    seriesLinks: SERIES_LINKS,
    moduleUrlTemplate: MODULE_URL_TEMPLATE,
  };
}

export function monthView(snap: CanaryWireSnapshot, month: string, standing: Accountability, savedAt: Date | null = null): CanaryWireView {
  const modules = snap.modules.filter((m) => m.month === month);
  const byEdition = new Map<string, SnapshotModule[]>();
  for (const m of [...modules].sort((a, b) => cmp(a.label, b.label))) {
    byEdition.set(m.edition, [...(byEdition.get(m.edition) ?? []), m]);
  }

  // One column per label, so a module shared by two editions is one column.
  const labels = columnOrder(modules);

  // The editions share content rather than copying it — most module ids sit
  // under more than one series — so whose a module is gets decided by id.
  // Comparing edition-tagged entries instead would make a shared module look
  // like another role's copy and invent off-role work for most of the company.
  const owners = new Map<string, Set<string>>();
  for (const m of modules) owners.set(m.module_id, (owners.get(m.module_id) ?? new Set()).add(m.edition));

  // Mindtickle has no "direct reports" field, only each user's manager, so a
  // people manager is anyone named as somebody's manager, by email or by name
  // since the field isn't always filled both ways. Built from the whole
  // roster so the answer doesn't change with the month. A manager whose
  // reports all sit outside the Canary Wire groups reads as an IC.
  const managers = new Set<string>();
  for (const l of snap.learners) {
    if (l.manager_email) managers.add(l.manager_email.trim().toLowerCase());
    if (l.manager) managers.add(l.manager.trim().toLowerCase());
  }
  const isIc = (email: string, name: string) =>
    !(managers.has(email.trim().toLowerCase()) || managers.has(name.trim().toLowerCase()));

  const reps: Rep[] = snap.learners.map((learner) => {
    const s = standing(learner.email, month, learner.role);
    const own = [...new Map((byEdition.get(learner.role) ?? []).map((m) => [m.module_id, m])).values()];
    const states = snap.progress[learner.email] ?? {};
    const cells: Record<string, Cell> = {};
    let assigned = 0;
    let done = 0;

    for (const mod of own) {
      const entry = states[mod.module_id] ?? { state: "", on: "", at: "" };
      const state = entry.state || NOT_STARTED;
      // Pre-bootcamp: the module is in their lineup but they don't owe it, so
      // it leaves every denominator. Anything they did anyway is still shown.
      if (s.exempt && norm(state) === norm(NOT_STARTED)) continue;
      if (!s.exempt) {
        assigned++;
        if (norm(state) === norm(COMPLETED)) done++;
      }
      cells[mod.label] = {
        state,
        on: entry.on,
        atPt: momentPt(entry),
        moduleId: mod.module_id,
        seriesId: mod.series_id,
        moduleType: mod.type,
        accountable: !s.exempt,
        exempt: s.exempt,
        also: [],
      };
    }

    // Work outside their own lineup: shown, never counted.
    const ownIds = new Set(own.map((m) => m.module_id));
    const foreign = new Map<string, SnapshotModule>();
    for (const mod of modules) if (!ownIds.has(mod.module_id) && !foreign.has(mod.module_id)) foreign.set(mod.module_id, mod);

    for (const mod of foreign.values()) {
      const entry = states[mod.module_id];
      if (!entry?.state || norm(entry.state) === norm(NOT_STARTED)) continue;
      const elsewhere: OtherCopy = {
        state: entry.state,
        on: entry.on,
        atPt: momentPt(entry),
        edition: [...(owners.get(mod.module_id) ?? [])].sort(cmp).join(", "),
      };
      const existing = cells[mod.label];
      if (existing) {
        existing.also.push(elsewhere);
      } else {
        cells[mod.label] = {
          state: entry.state,
          on: entry.on,
          atPt: elsewhere.atPt,
          moduleId: mod.module_id,
          seriesId: mod.series_id,
          moduleType: mod.type,
          accountable: false,
          exempt: false,
          also: [],
          edition: elsewhere.edition,
        };
      }
    }

    return {
      name: learner.name,
      email: learner.email,
      role: learner.role,
      manager: learner.manager || "(no manager on record)",
      managerEmail: learner.manager_email,
      title: learner.title,
      notActivated: learner.state === NOT_ACTIVATED,
      ic: isIc(learner.email, learner.name),
      exempt: s.exempt,
      exemptFrom: s.exempt ? s.from : "",
      exemptSource: s.source,
      cells,
      assigned,
      completed: done,
      pct: rate(done, assigned),
      // A pre-bootcamp rep's own modules are uncounted too, but that is
      // exemption, not off-role work.
      offRole: Object.values(cells).reduce((n, c) => n + c.also.length + (c.accountable || c.exempt ? 0 : 1), 0),
    };
  });

  const sum = (rows: Rep[], f: (r: Rep) => number) => rows.reduce((n, r) => n + f(r), 0);

  const teams: Team[] = [...new Set(reps.map((r) => r.manager))].sort(cmp).map((manager) => {
    const team = reps.filter((r) => r.manager === manager);
    const assigned = sum(team, (r) => r.assigned);
    const done = sum(team, (r) => r.completed);
    return {
      manager,
      managerEmail: team.find((r) => r.managerEmail)?.managerEmail ?? "",
      roles: [...new Set(team.map((r) => r.role))].sort(cmp),
      directs: [...team].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0) || cmp(a.name, b.name)),
      // Pre-bootcamp reps stay visible as rows but leave the head count.
      learners: team.filter((r) => !r.exempt).length,
      exempt: team.filter((r) => r.exempt).length,
      assigned,
      completed: done,
      pct: rate(done, assigned),
      fullyComplete: team.filter((r) => r.assigned && r.completed >= r.assigned).length,
      notActivated: team.filter((r) => r.notActivated && !r.exempt).length,
    };
  });
  // Best first. A team that owes nothing this month has no rate and sorts last.
  const teamKey = (t: Team) => (t.pct === null ? 1 : -t.pct);
  teams.sort((a, b) => teamKey(a) - teamKey(b) || cmp(a.manager, b.manager));

  const roles: RoleRow[] = [...new Set(reps.map((r) => r.role))].sort(cmp).map((role) => {
    const crew = reps.filter((r) => r.role === role);
    const ics = crew.filter((r) => r.ic);
    return {
      role,
      learners: crew.filter((r) => !r.exempt).length,
      exempt: crew.filter((r) => r.exempt).length,
      assigned: sum(crew, (r) => r.assigned),
      completed: sum(crew, (r) => r.completed),
      pct: rate(sum(crew, (r) => r.completed), sum(crew, (r) => r.assigned)),
      icLearners: ics.filter((r) => !r.exempt).length,
      icAssigned: sum(ics, (r) => r.assigned),
      icCompleted: sum(ics, (r) => r.completed),
      icPct: rate(sum(ics, (r) => r.completed), sum(ics, (r) => r.assigned)),
      modules: [...new Set((byEdition.get(role) ?? []).map((m) => m.label))].sort(cmp),
    };
  });

  const ics = reps.filter((r) => r.ic);
  return {
    month,
    months: offeredMonths(snap),
    monthsWithData: contentMonths(snap),
    hasSnapshot: true,
    hasData: modules.length > 0,
    labels,
    modules: [...modules]
      .sort((a, b) => cmp(a.label, b.label) || cmp(a.edition, b.edition))
      .map((m) => ({ label: m.label, edition: m.edition, name: m.name })),
    teams,
    roles,
    totals: {
      learners: reps.filter((r) => !r.exempt).length,
      exempt: reps.filter((r) => r.exempt).length,
      rostered: reps.length,
      assigned: sum(reps, (r) => r.assigned),
      completed: sum(reps, (r) => r.completed),
      pct: rate(sum(reps, (r) => r.completed), sum(reps, (r) => r.assigned)),
      icLearners: ics.filter((r) => !r.exempt).length,
      icAssigned: sum(ics, (r) => r.assigned),
      icCompleted: sum(ics, (r) => r.completed),
      icPct: rate(sum(ics, (r) => r.completed), sum(ics, (r) => r.assigned)),
      fullyComplete: reps.filter((r) => r.assigned && r.completed >= r.assigned).length,
      notActivated: reps.filter((r) => r.notActivated && !r.exempt).length,
    },
    lastActivity: lastActivity(snap, new Map(modules.map((m) => [m.module_id, m.label]))),
    fetchedAtPt: toPacific(snap.fetched_at),
    savedAt: savedAt?.toISOString() ?? null,
    notes: snap.notes,
    seriesLinks: SERIES_LINKS,
    moduleUrlTemplate: MODULE_URL_TEMPLATE,
  };
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The month as a flat export: one row per rep, one column per module. */
export function monthCsv(view: CanaryWireView): string {
  const header = [
    "Name", "Email", "Role", "Manager", "Manager Email",
    ...view.labels,
    "Modules Assigned", "Modules Completed", "Completion %", "Account",
  ];
  const rows = [header];
  for (const team of view.teams) {
    for (const rep of team.directs) {
      const line = [rep.name, rep.email, rep.role, rep.manager, rep.managerEmail];
      for (const label of view.labels) {
        const cell = rep.cells[label];
        if (!cell) {
          line.push("");
          continue;
        }
        // Flagged in the text, so a completion is never mistaken for something owed.
        let text = cell.accountable
          ? cell.state
          : cell.exempt
            ? `${cell.state} (${rep.exemptSource === "first_month" ? "new hire" : "pre-bootcamp"}, not counted)`
            : `${cell.state} (off-role)`;
        for (const other of cell.also) text += ` [also ${other.state.toLowerCase()} ${other.edition} copy, off-role]`;
        line.push(text);
      }
      const account = rep.exempt
        ? rep.exemptSource === "first_month"
          ? `New hire — counts from ${rep.exemptFrom}`
          : "Pre-bootcamp — not accountable this month"
        : rep.notActivated ? "Never activated Mindtickle" : "Active";
      line.push(String(rep.assigned), String(rep.completed), rep.pct === null ? "" : rep.pct.toFixed(1), account);
      rows.push(line);
    }
  }
  return rows.map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}
