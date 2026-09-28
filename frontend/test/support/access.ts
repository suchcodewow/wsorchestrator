/**
 * Every combination of roles a person can hold, and a named handful of them.
 *
 * `EVERY_ACCESS` is what makes the role tests exhaustive rather than
 * illustrative: 5 event roles × 3 scheduler states × 3 eVals states × the
 * platform flag is 90 people, few enough to check each one. A new role added
 * to `EVENT_ROLES`, `SCHEDULER_ROLES` or `EVALS_ROLES` is picked up here
 * without anyone remembering to.
 */

import { EVALS_ROLES, EVENT_ROLES, SCHEDULER_ROLES } from "@/db/schema";
import type { Access } from "@/lib/roles";

export const EVERY_ACCESS: Access[] = EVENT_ROLES.flatMap((event) =>
  [null, ...SCHEDULER_ROLES].flatMap((scheduler) =>
    [null, ...EVALS_ROLES].flatMap((evals) =>
      [false, true].map((platform) => ({ event, scheduler, evals, platform })),
    ),
  ),
);

export const PERSONAS = {
  nobody: { event: "none", scheduler: null, evals: null, platform: false },
  contributor: { event: "contributor", scheduler: null, evals: null, platform: false },
  operator: { event: "operator", scheduler: null, evals: null, platform: false },
  manager: { event: "manager", scheduler: null, evals: null, platform: false },
  eventAdmin: { event: "administrator", scheduler: null, evals: null, platform: false },
  schedulerViewer: { event: "none", scheduler: "viewer", evals: null, platform: false },
  schedulerAdmin: { event: "none", scheduler: "administrator", evals: null, platform: false },
  evalsViewer: { event: "none", scheduler: null, evals: "viewer", platform: false },
  evalsAdmin: { event: "none", scheduler: null, evals: "administrator", platform: false },
  /** Both areas' administrator, which is still not a platform administrator. */
  bothAdmins: { event: "administrator", scheduler: "administrator", evals: null, platform: false },
  /** Stored roles of nothing: the flag alone has to carry everything. */
  platform: { event: "none", scheduler: null, evals: null, platform: true },
} as const satisfies Record<string, Access>;

export type Persona = keyof typeof PERSONAS;

export const PERSONA_NAMES = Object.keys(PERSONAS) as Persona[];

/** `event=manager scheduler=viewer evals=- platform` — for test names and failure output. */
export function describeAccess(a: Access): string {
  return [
    `event=${a.event}`,
    `scheduler=${a.scheduler ?? "-"}`,
    `evals=${a.evals ?? "-"}`,
    ...(a.platform ? ["platform"] : []),
  ].join(" ");
}
