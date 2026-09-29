/** Who sits beneath a leader in HiBob's reporting lines. */

/** The leader whose organization eVals draws its attendees from. */
export const ORG_ROOT_EMAIL = "carlos.delatorre@harness.io";

export type OrgPerson = { email: string; reportsToEmail: string };

/**
 * Everyone whose chain of managers reaches `rootEmail`, each with that chain
 * from their own manager up to and including the root. The root is not among
 * them. A chain that loops or runs into someone not in `people` ends there,
 * and anyone on it is left out.
 */
export function orgUnder<T extends OrgPerson>(
  people: readonly T[],
  rootEmail: string = ORG_ROOT_EMAIL,
): (T & { chain: string[] })[] {
  const root = rootEmail.toLowerCase();
  const managerOf = new Map(people.map((p) => [p.email.toLowerCase(), p.reportsToEmail.toLowerCase()]));

  const members: (T & { chain: string[] })[] = [];
  for (const person of people) {
    const email = person.email.toLowerCase();
    if (email === root) continue;

    const chain: string[] = [];
    const seen = new Set([email]);
    let current = email;
    for (;;) {
      const manager = managerOf.get(current);
      if (!manager || seen.has(manager)) break;
      chain.push(manager);
      if (manager === root) {
        members.push({ ...person, chain });
        break;
      }
      seen.add(manager);
      current = manager;
    }
  }
  return members;
}
