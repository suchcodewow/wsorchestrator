/**
 * Everyone under the org root, with the list their title is on and their
 * bootcamp history — what the HiBob tab shows, and what candidate loading
 * will read.
 */

import "server-only";

import { db } from "@/db";
import { bootcampHistory, employees, type Employee, type EvalsTitleList } from "@/db/schema";
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
