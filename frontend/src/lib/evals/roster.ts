/**
 * Everyone under the org root, with the list their title is on and their
 * bootcamp history — what the HiBob tab shows, and what candidate loading
 * will read.
 */

import "server-only";

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

/** Every imported employee's name, by lowercased email. */
export async function employeeNamesByEmail(): Promise<Map<string, string>> {
  const rows = await db
    .select({ email: employees.email, fullName: employees.fullName })
    .from(employees);
  return new Map(rows.map((r) => [r.email, r.fullName]));
}

export type EmployeeListing = Omit<Employee, "raw" | "importedAt">;

/** Every stored employee, for the Employees tab — not only those under the root. */
export async function listEmployees(): Promise<{ people: EmployeeListing[]; syncedAt: Date | null }> {
  const rows = await db
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
      importedAt: employees.importedAt,
    })
    .from(employees)
    .orderBy(employees.fullName);
  // A sync stamps every row with the same time.
  const syncedAt = rows[0]?.importedAt ?? null;
  return { people: rows.map(({ importedAt: _, ...person }) => person), syncedAt };
}

export type OrganizationSnapshot = {
  /** Everyone found under the leader as of the last sync, deepest last. */
  members: EvalsOrganizationMember[];
  /** Who the snapshot was computed for — null if no sync has run yet. */
  leaderEmail: string | null;
  /** False once an admin has picked a different leader since that sync ran. */
  current: boolean;
};

/**
 * The Organization tab's data: who the last HiBob sync found reporting up to
 * the configured Organization Leader. Read from `evals_organization_members`
 * rather than recomputed here, because the chain is only ever as fresh as the
 * last sync — recomputing on every page view would silently show a chain
 * HiBob has not actually synced yet.
 */
export async function listOrganizationMembers(): Promise<OrganizationSnapshot> {
  const [rows, configuredLeader] = await Promise.all([
    db
      .select()
      .from(evalsOrganizationMembers)
      .orderBy(evalsOrganizationMembers.depth, evalsOrganizationMembers.fullName),
    getOrgLeaderEmail(),
  ]);
  const leaderEmail = rows[0]?.leaderEmail ?? null;
  return {
    members: rows,
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
