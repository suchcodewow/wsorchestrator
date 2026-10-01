/**
 * Everyone under the org root, with the list their title is on and their
 * bootcamp history — what the HiBob tab shows, and what candidate loading
 * will read.
 */

import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bootcampHistory,
  employees,
  evalsOrganizationMembers,
  type Employee,
  type EvalsOrganizationMember,
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

export type EmployeeListing = Omit<Employee, "raw" | "importedAt">;

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
 * One page of stored employees, for the Employees tab and the Organization
 * Leader picker — everyone the sync stored, not only those under the root.
 */
export async function listEmployees(query: ListQuery<EmployeeSort>): Promise<Page<EmployeeListing>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select(EMPLOYEE_COLUMNS)
    .from(employees)
    .where(
      searchAny(query.q, [
        employees.fullName,
        employees.email,
        employees.title,
        employees.department,
        employees.site,
        employees.reportsToName,
        employees.reportsToEmail,
      ]),
    )
    .orderBy(...orderFor(EMPLOYEE_SORT_COLUMNS[query.sort], query.dir, employees.fullName, employees.id))
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}

/** How many employees are stored, and when the sync that stored them ran. */
export async function employeeSummary(): Promise<{ count: number; syncedAt: Date | null }> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      // A sync stamps every row with the same time.
      syncedAt: sql<string | null>`max(${employees.importedAt})`,
    })
    .from(employees);
  return { count: row?.count ?? 0, syncedAt: row?.syncedAt ? new Date(row.syncedAt) : null };
}

/** One employee's name, by email, or null — the Organization Leader as the picker shows it. */
export async function employeeByEmail(email: string): Promise<{ email: string; fullName: string } | null> {
  if (!email) return null;
  const [row] = await db
    .select({ email: employees.email, fullName: employees.fullName })
    .from(employees)
    .where(sql`lower(${employees.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return row ?? null;
}

export type OrganizationSummary = {
  /** How many people the last sync found under the leader. */
  count: number;
  /** Who that sync computed them for — null if no sync has run yet. */
  leaderEmail: string | null;
  /** False once an admin has picked a different leader since that sync ran. */
  current: boolean;
};

const ORGANIZATION_SORT_COLUMNS = {
  depth: evalsOrganizationMembers.depth,
  fullName: sql`lower(${evalsOrganizationMembers.fullName})`,
  email: evalsOrganizationMembers.email,
  title: sql`lower(${blankAsNull(evalsOrganizationMembers.title)})`,
  department: sql`lower(${blankAsNull(evalsOrganizationMembers.department)})`,
  reportsToName: sql`lower(coalesce(${blankAsNull(evalsOrganizationMembers.reportsToName)}, ${blankAsNull(evalsOrganizationMembers.reportsToEmail)}))`,
} as const;

/**
 * One page of the Organization tab: who the last HiBob sync found reporting
 * up to the configured Organization Leader. Read from
 * `evals_organization_members` rather than recomputed here, because the chain
 * is only ever as fresh as the last sync — recomputing on every page view
 * would silently show a chain HiBob has not actually synced yet.
 */
export async function listOrganizationMembers(
  query: ListQuery<OrganizationSort>,
): Promise<Page<EvalsOrganizationMember>> {
  const { limit, offset } = pageWindow(query.page);
  const m = evalsOrganizationMembers;
  const rows = await db
    .select()
    .from(m)
    .where(searchAny(query.q, [m.fullName, m.email, m.title, m.department, m.reportsToName, m.reportsToEmail]))
    .orderBy(...orderFor(ORGANIZATION_SORT_COLUMNS[query.sort], query.dir, sql`lower(${m.fullName})`, m.email))
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}

/** How many the Organization tab lists, and whether they are still for the configured leader. */
export async function organizationSummary(): Promise<OrganizationSummary> {
  const [[row], configuredLeader] = await Promise.all([
    db
      .select({
        count: sql<number>`count(*)::int`,
        // A sync writes every row for the same leader.
        leaderEmail: sql<string | null>`min(${evalsOrganizationMembers.leaderEmail})`,
      })
      .from(evalsOrganizationMembers),
    getOrgLeaderEmail(),
  ]);
  const leaderEmail = row?.leaderEmail ?? null;
  return {
    count: row?.count ?? 0,
    leaderEmail,
    current: leaderEmail === null || leaderEmail === configuredLeader.toLowerCase(),
  };
}

export async function loadRoster(rootEmail?: string): Promise<Roster> {
  const [staff, lists, history, configuredLeader] = await Promise.all([
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
      })
      .from(employees),
    titleListMap(),
    db
      .select({
        email: bootcampHistory.email,
        btcDate: bootcampHistory.btcDate,
        intDate: bootcampHistory.intDate,
      })
      .from(bootcampHistory),
    rootEmail ? Promise.resolve(rootEmail) : getOrgLeaderEmail(),
  ]);

  const historyByEmail = new Map(history.map((h) => [h.email, h]));
  const root = configuredLeader.toLowerCase();

  const people = orgUnder(staff, root)
    .map(({ chain, ...person }): RosterPerson => {
      const h = historyByEmail.get(person.email);
      return {
        ...person,
        depth: chain.length,
        list: listForTitle(person.title, lists),
        btcDate: h?.btcDate ?? null,
        intDate: h?.intDate ?? null,
      };
    })
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
