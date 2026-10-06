/**
 * Who a Canary Wire learner is, by HiBob. Mindtickle supplies the roster —
 * who is in each edition's role group — but the rest of the app knows people
 * by the HiBob sync, so names, titles and reporting lines come from the
 * `employees` table, matched by email, for the page to agree with Cohorts and
 * Employees. Someone HiBob doesn't have keeps what Mindtickle says.
 */

import type { CanaryWireSnapshot } from "@/lib/canary-wire/snapshot";
import { orgUnder } from "@/lib/evals/org";

export type Person = {
  /** Lowercased, as the employees table holds it. */
  email: string;
  fullName: string;
  title: string;
  /** Lowercased; empty for someone who reports to nobody. */
  reportsToEmail: string;
  reportsToName: string;
};

/**
 * The snapshot with each learner's name, title and manager taken from HiBob
 * where it has them. A manager is named as the employee list names them, so a
 * team reads the same here as anywhere else in the app.
 */
export function withHiBob(snap: CanaryWireSnapshot, people: Map<string, Person>): CanaryWireSnapshot {
  return {
    ...snap,
    learners: snap.learners.map((l) => {
      const p = people.get(l.email.trim().toLowerCase());
      if (!p) return l;
      const boss = p.reportsToEmail ? people.get(p.reportsToEmail) : undefined;
      return {
        ...l,
        name: p.fullName || l.name,
        title: p.title || l.title,
        manager: p.reportsToEmail ? (boss?.fullName ?? p.reportsToName) || l.manager : "",
        manager_email: p.reportsToEmail,
      };
    }),
  };
}

/**
 * A manager's org, as "My org" shows it: themselves and everyone under them,
 * every level down, by HiBob's reporting lines.
 */
export function orgOf(people: Map<string, Person>, managerEmail: string): Set<string> {
  const me = managerEmail.trim().toLowerCase();
  return new Set([me, ...orgUnder([...people.values()], me).map((p) => p.email)]);
}

/** Only the learners in `emails`: a manager's org. Someone HiBob doesn't have can't be placed in one. */
export function onlyOrg(snap: CanaryWireSnapshot, emails: Set<string>): CanaryWireSnapshot {
  return { ...snap, learners: snap.learners.filter((l) => emails.has(l.email.trim().toLowerCase())) };
}

/** Everyone HiBob has anyone reporting to: the people managers, org-wide. */
export function managersOf(people: Map<string, Person>): Set<string> {
  const out = new Set<string>();
  for (const p of people.values()) if (p.reportsToEmail) out.add(p.reportsToEmail);
  return out;
}
