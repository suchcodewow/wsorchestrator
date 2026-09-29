/**
 * Everyone under the org root, with the list their title is on and their
 * bootcamp history — what the HiBob tab shows, and what candidate loading
 * will read.
 */

import "server-only";

import { db } from "@/db";
import { bootcampHistory, hibobEmployees, type EvalsTitleList } from "@/db/schema";
import { orgUnder, ORG_ROOT_EMAIL } from "@/lib/evals/org";
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
    .select({ email: hibobEmployees.email, fullName: hibobEmployees.fullName })
    .from(hibobEmployees);
  return new Map(rows.map((r) => [r.email, r.fullName]));
}

export async function loadRoster(rootEmail = ORG_ROOT_EMAIL): Promise<Roster> {
  const [employees, lists, history] = await Promise.all([
    db
      .select({
        id: hibobEmployees.id,
        email: hibobEmployees.email,
        fullName: hibobEmployees.fullName,
        title: hibobEmployees.title,
        department: hibobEmployees.department,
        site: hibobEmployees.site,
        reportsToEmail: hibobEmployees.reportsToEmail,
        reportsToName: hibobEmployees.reportsToName,
        startDate: hibobEmployees.startDate,
        activeEffectiveDate: hibobEmployees.activeEffectiveDate,
      })
      .from(hibobEmployees),
    titleListMap(),
    db
      .select({
        email: bootcampHistory.email,
        btcDate: bootcampHistory.btcDate,
        intDate: bootcampHistory.intDate,
      })
      .from(bootcampHistory),
  ]);

  const historyByEmail = new Map(history.map((h) => [h.email, h]));
  const root = rootEmail.toLowerCase();

  const people = orgUnder(employees, root)
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
    rootFound: employees.some((e) => e.email === root),
    employeeCount: employees.length,
    people,
    unlisted: [...counts.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title)),
  };
}
