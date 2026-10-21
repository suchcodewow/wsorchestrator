/**
 * Everyone under the org root, with the list their title is on and their
 * bootcamp history — what the HiBob tab shows, and what candidate loading
 * will read.
 */

import "server-only";

import { and, desc, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  hibobSyncRuns,
  type Employee,
  type EvalsTitleList,
} from "@/db/schema";
import { orgUnder } from "@/lib/evals/org";
import type { EmployeeSort, OrganizationSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { blankAsNull, orderFor, searchAny } from "@/lib/paging-sql";
import { getOrgLeaderEmail } from "@/lib/evals/settings";
import { listForTitle, titleKey } from "@/lib/evals/title-lists";
import { titleListMap } from "@/lib/evals/titles";

export type RosterPerson = {
  id: string;
  email: string;
  fullName: string;
  title: string;
  department: string;
  site: string;
  reportsToEmail: string;
  reportsToName: string;
  startDate: string | null;
  activeEffectiveDate: string | null;
  /** How many managers sit between this person and the org root, counting the root. */
  depth: number;
  list: EvalsTitleList | null;
  btcDate: string | null;
  intDate: string | null;
};

export type UnlistedTitle = { title: string; count: number };

export type Roster = {
  rootEmail: string;
  /** Whether the root is among the imported employees at all. */
  rootFound: boolean;
  employeeCount: number;
  people: RosterPerson[];
  /** Titles in the org on no list, most common first. */
  unlisted: UnlistedTitle[];
};

export type EmployeeListing = Pick<
  Employee,
  "id" | "email" | "fullName" | "title" | "department" | "site" | "reportsToEmail" | "reportsToName" | "startDate" | "activeEffectiveDate"
> & {
  /** Whether `fullName` is one they chose for themselves (`employees.chosen_name`) rather than their email's. */
  nameChosen: boolean;
};

const EMPLOYEE_COLUMNS = {
  id: employees.id,
  email: employees.email,
  fullName: employees.fullName,
  title: employees.title,
  department: employees.department,
  site: employees.site,
  reportsToEmail: employees.reportsToEmail,
  reportsToName: employees.reportsToName,
  startDate: employees.startDate,
  activeEffectiveDate: employees.activeEffectiveDate,
  nameChosen: sql<boolean>`${employees.chosenName} is not null`,
};

const EMPLOYEE_SORT_COLUMNS = {
  fullName: sql`lower(${employees.fullName})`,
  email: employees.email,
  title: sql`lower(${blankAsNull(employees.title)})`,
  department: sql`lower(${blankAsNull(employees.department)})`,
  site: sql`lower(${blankAsNull(employees.site)})`,
  reportsToName: sql`lower(coalesce(${blankAsNull(employees.reportsToName)}, ${blankAsNull(employees.reportsToEmail)}))`,
  startDate: employees.startDate,
  activeEffectiveDate: employees.activeEffectiveDate,
} as const;

/**
 * What an employee search looks in: `all` is every column the Employees tab
 * shows, manager included; `person` is only the name and email, for a picker
 * finding one person, where a search for a manager would list their reports.
 */
export const EMPLOYEE_MATCHES = ["all", "person"] as const;
export type EmployeeMatch = (typeof EMPLOYEE_MATCHES)[number];

/**
 * One page of stored employees, for the Employees tab and the people pickers
 * — everyone the sync stored, not only those under the root.
 */
export async function listEmployees(
  query: ListQuery<EmployeeSort>,
  match: EmployeeMatch = "all",
): Promise<Page<EmployeeListing>> {
  const { limit, offset } = pageWindow(query.page);
  const searched =
    match === "person"
      ? [employees.fullName, employees.email]
      : [
          employees.fullName,
          employees.email,
          employees.title,
          employees.department,
          employees.site,
          employees.reportsToName,
          employees.reportsToEmail,
        ];
  const rows = await db
    .select(EMPLOYEE_COLUMNS)
    .from(employees)
    .where(and(eq(employees.active, true), searchAny(query.q, searched)))
    .orderBy(...orderFor(EMPLOYEE_SORT_COLUMNS[query.sort], query.dir, employees.fullName, employees.id))
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}

/** How many current employees are stored, and when the sync that stored them ran. */
export async function employeeSummary(): Promise<{ count: number; syncedAt: Date | null }> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      // A sync stamps every row with the same time.
      syncedAt: sql<string | null>`max(${employees.importedAt})`,
    })
    .from(employees)
    .where(eq(employees.active, true));
  return { count: row?.count ?? 0, syncedAt: row?.syncedAt ? new Date(row.syncedAt) : null };
}

/**
 * Someone still at Harness, by email, with their name, or null — the
 * Organization Leader as the picker shows them, or a judge or contact being
 * added, each of whom must be in HiBob.
 */
export async function employeeByEmail(email: string): Promise<{ email: string; fullName: string } | null> {
  if (!email) return null;
  const [row] = await db
    .select({ email: employees.email, fullName: employees.fullName })
    .from(employees)
    .where(and(sql`lower(${employees.email}) = ${email.toLowerCase()}`, eq(employees.active, true)))
    .limit(1);
  return row ?? null;
}

/**
 * The name the employee list has for the lowercased email in `email`, or ''
 * for none: for the lists that name people by email alone — judges, contacts,
 * session staff and groups. Someone who has left keeps the name they had.
 * `email` is spelled out with its table (`sql.raw("bootcamp_judges.email")`):
 * in a one-table select drizzle leaves a column unqualified, and inside this
 * it would then be the employee's own.
 */
export function employeeNameOf(email: SQL): SQL<string> {
  return sql<string>`coalesce((select nullif(n.full_name, '') from ${employees} n where n.email = ${email}
    order by n.active desc, n.imported_at desc, n.id limit 1), '')`;
}

export type OrganizationSummary = {
  /** How many people the last sync found under the leader. */
  count: number;
  /** Who that sync computed them for — null if no sync has run yet. */
  leaderEmail: string | null;
  /** False once an admin has picked a different leader since that sync ran. */
  current: boolean;
};

/** Someone the last sync found under the Organization Leader, as the Organization tab lists them. */
export type OrganizationMember = Pick<
  Employee,
  "email" | "fullName" | "title" | "department" | "reportsToEmail" | "reportsToName" | "track" | "btcDate" | "btcScore" | "intDate" | "intScore"
> & {
  /** Links between this person and the leader, counting the leader. */
  depth: number;
  /** Lowercased; whom the sync that stored them worked `depth` out for. */
  leaderEmail: string;
  /** Their managers' emails, the direct one first and the leader last, joined with `;`. */
  managementChain: string;
};

const ORGANIZATION_SORT_COLUMNS = {
  depth: employees.orgDepth,
  fullName: sql`lower(${employees.fullName})`,
  email: employees.email,
  title: sql`lower(${blankAsNull(employees.title)})`,
  department: sql`lower(${blankAsNull(employees.department)})`,
  reportsToName: sql`lower(coalesce(${blankAsNull(employees.reportsToName)}, ${blankAsNull(employees.reportsToEmail)}))`,
  track: employees.track,
  btcDate: employees.btcDate,
  btcScore: employees.btcScore,
  intDate: employees.intDate,
  intScore: employees.intScore,
} as const;

/** Whom the latest successful sync worked `employees.org_depth` out for, or null if none has. */
async function syncedLeaderEmail(): Promise<string | null> {
  const [run] = await db
    .select({ leaderEmail: hibobSyncRuns.orgLeaderEmail })
    .from(hibobSyncRuns)
    .where(eq(hibobSyncRuns.status, "succeeded"))
    .orderBy(desc(hibobSyncRuns.startedAt))
    .limit(1);
  return run?.leaderEmail ?? null;
}

/**
 * One page of the Organization tab: the employees the last HiBob sync found
 * reporting up to the Organization Leader, which is those it gave an
 * `org_depth`, each with their BTC and INT dates and scores. Read from what the sync stored rather than recomputed here,
 * because the chain is only ever as fresh as the last sync — recomputing on
 * every page view would silently show a chain HiBob has not actually synced yet.
 */
export async function listOrganizationMembers(
  query: ListQuery<OrganizationSort>,
): Promise<Page<OrganizationMember>> {
  const { limit, offset } = pageWindow(query.page);
  const e = employees;
  const [rows, leaderEmail] = await Promise.all([
    db
      .select({
        email: e.email,
        fullName: e.fullName,
        title: e.title,
        department: e.department,
        reportsToEmail: e.reportsToEmail,
        reportsToName: e.reportsToName,
        track: e.track,
        depth: sql<number>`${e.orgDepth}`,
        managementChain: sql<string>`coalesce(${e.managementChain}, '')`,
        btcDate: e.btcDate,
        btcScore: e.btcScore,
        intDate: e.intDate,
        intScore: e.intScore,
      })
      .from(e)
      .where(
        and(
          isNotNull(e.orgDepth),
          searchAny(query.q, [e.fullName, e.email, e.title, e.department, e.reportsToName, e.reportsToEmail, e.track]),
        ),
      )
      .orderBy(...orderFor(ORGANIZATION_SORT_COLUMNS[query.sort], query.dir, sql`lower(${e.fullName})`, e.id))
      .limit(limit)
      .offset(offset),
    syncedLeaderEmail(),
  ]);
  return toPage(rows.map((r) => ({ ...r, leaderEmail: leaderEmail ?? "" })), query.page);
}

/** How many the Organization tab lists, and whether they are still for the configured leader. */
export async function organizationSummary(): Promise<OrganizationSummary> {
  const [[row], leaderEmail, configuredLeader] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(employees)
      .where(isNotNull(employees.orgDepth)),
    syncedLeaderEmail(),
    getOrgLeaderEmail(),
  ]);
  return {
    count: row?.count ?? 0,
    leaderEmail,
    current: leaderEmail === null || leaderEmail === configuredLeader.toLowerCase(),
  };
}

export async function loadRoster(rootEmail?: string): Promise<Roster> {
  const [staff, lists, configuredLeader] = await Promise.all([
    db
      .select({
        id: employees.id,
        email: employees.email,
        fullName: employees.fullName,
        title: employees.title,
        department: employees.department,
        site: employees.site,
        reportsToEmail: employees.reportsToEmail,
        reportsToName: employees.reportsToName,
        startDate: employees.startDate,
        activeEffectiveDate: employees.activeEffectiveDate,
        btcDate: employees.btcDate,
        intDate: employees.intDate,
      })
      .from(employees)
      .where(eq(employees.active, true)),
    titleListMap(),
    rootEmail ? Promise.resolve(rootEmail) : getOrgLeaderEmail(),
  ]);

  const root = configuredLeader.toLowerCase();

  const people = orgUnder(staff, root)
    .map(({ chain, ...person }): RosterPerson => ({
      ...person,
      depth: chain.length,
      list: listForTitle(person.title, lists),
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  const counts = new Map<string, UnlistedTitle>();
  for (const p of people) {
    if (p.list || !p.title) continue;
    const key = titleKey(p.title);
    const entry = counts.get(key) ?? { title: p.title.trim(), count: 0 };
    entry.count++;
    counts.set(key, entry);
  }

  return {
    rootEmail: root,
    rootFound: staff.some((e) => e.email === root),
    employeeCount: staff.length,
    people,
    unlisted: [...counts.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title)),
  };
}
