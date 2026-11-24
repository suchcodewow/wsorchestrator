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
export function orgUnder<T extends OrgPerson>(people: readonly T[], rootEmail: string = ORG_ROOT_EMAIL): (T & { chain: string[] })[] {
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

/**
 * The managers in a stored `management_chain` (lowercased emails joined with
 * `;`, the direct manager first), cut off at `leaderEmail`, who is the last one
 * kept. Anyone above the leader is dropped, so a chain stored under an earlier
 * leader never reaches past the one set now. A chain that never names the
 * leader, or none, yields no one.
 */
export function chainUpTo(chain: string | null, leaderEmail: string): string[] {
  const leader = leaderEmail.trim().toLowerCase();
  const managers = (chain ?? "")
    .split(";")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const at = managers.indexOf(leader);
  return at < 0 ? [] : managers.slice(0, at + 1);
}

/**
 * Who manages someone, for whoever is told about them or may see them: their
 * stored chain up to the leader (`chainUpTo`), or, when they sit outside the
 * leader's organization and so have none, their direct manager alone. The
 * fallback goes one level and no further.
 */
export function managersFor(chain: string | null, reportsToEmail: string | null, leaderEmail: string): string[] {
  const upToLeader = chainUpTo(chain, leaderEmail);
  if (upToLeader.length > 0) return upToLeader;
  const direct = (reportsToEmail ?? "").trim().toLowerCase();
  return direct ? [direct] : [];
}
