/**
 * Every combination of roles a person can hold, and a named handful of them.
 *
 * `EVERY_ACCESS` is what makes the role tests exhaustive rather than
 * illustrative: 5 event roles × 3 scheduler states × the platform flag is 30
 * people, few enough to check each one. A new role added to `EVENT_ROLES` or
 * `SCHEDULER_ROLES` is picked up here without anyone remembering to.
 */

import { EVENT_ROLES, SCHEDULER_ROLES } from "@/db/schema";
import type { Access } from "@/lib/roles";

export const EVERY_ACCESS: Access[] = EVENT_ROLES.flatMap((event) =>
  [null, ...SCHEDULER_ROLES].flatMap((scheduler) =>
    [false, true].map((platform) => ({ event, scheduler, platform })),
  ),
);

export const PERSONAS = {
  nobody: { event: "none", scheduler: null, platform: false },
  contributor: { event: "contributor", scheduler: null, platform: false },
  operator: { event: "operator", scheduler: null, platform: false },
  manager: { event: "manager", scheduler: null, platform: false },
  eventAdmin: { event: "administrator", scheduler: null, platform: false },
  schedulerViewer: { event: "none", scheduler: "viewer", platform: false },
  schedulerAdmin: { event: "none", scheduler: "administrator", platform: false },
  /** Both areas' administrator, which is still not a platform administrator. */
  bothAdmins: { event: "administrator", scheduler: "administrator", platform: false },
  /** Stored roles of nothing: the flag alone has to carry everything. */
  platform: { event: "none", scheduler: null, platform: true },
} as const satisfies Record<string, Access>;

export type Persona = keyof typeof PERSONAS;

export const PERSONA_NAMES = Object.keys(PERSONAS) as Persona[];

/** `event=manager scheduler=viewer platform` — for test names and failure output. */
export function describeAccess(a: Access): string {
  return [
    `event=${a.event}`,
    `scheduler=${a.scheduler ?? "-"}`,
    ...(a.platform ? ["platform"] : []),
  ].join(" ");
}
