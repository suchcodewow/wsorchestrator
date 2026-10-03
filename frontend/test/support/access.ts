/**
 * Every combination of roles a person can hold, and a named handful of them.
 *
 * `EVERY_ACCESS` is what makes the role tests exhaustive rather than
 * illustrative: 5 event roles × 3 training states × 3 eVals states × the
 * platform flag × judging or not is 180 people, few enough to check each one. A new role added
 * to `EVENT_ROLES`, `TRAINING_ROLES` or `EVALS_ROLES` is picked up here
 * without anyone remembering to.
 */

import { EVALS_ROLES, EVENT_ROLES, TRAINING_ROLES } from "@/db/schema";
import type { Access } from "@/lib/roles";

export const EVERY_ACCESS: Access[] = EVENT_ROLES.flatMap((event) =>
  [null, ...TRAINING_ROLES].flatMap((training) =>
    [null, ...EVALS_ROLES].flatMap((evals) =>
      [false, true].flatMap((platform) =>
        [false, true].map((judging) => ({ event, training, evals, platform, judging })),
      ),
    ),
  ),
);

export const PERSONAS = {
  nobody: { event: "none", training: null, evals: null, platform: false, judging: false },
  contributor: { event: "contributor", training: null, evals: null, platform: false, judging: false },
  operator: { event: "operator", training: null, evals: null, platform: false, judging: false },
  manager: { event: "manager", training: null, evals: null, platform: false, judging: false },
  eventAdmin: { event: "administrator", training: null, evals: null, platform: false, judging: false },
  trainingViewer: { event: "none", training: "viewer", evals: null, platform: false, judging: false },
  trainingAdmin: { event: "none", training: "administrator", evals: null, platform: false, judging: false },
  evalsViewer: { event: "none", training: null, evals: "viewer", platform: false, judging: false },
  evalsAdmin: { event: "none", training: null, evals: "administrator", platform: false, judging: false },
  /** Both areas' administrator, which is still not a platform administrator. */
  bothAdmins: { event: "administrator", training: "administrator", evals: null, platform: false, judging: false },
  /** A guest judge on the active bootcamp, with no role anywhere. */
  guestJudge: { event: "none", training: null, evals: null, platform: false, judging: true },
  /** Stored roles of nothing: the flag alone has to carry everything. */
  platform: { event: "none", training: null, evals: null, platform: true, judging: false },
} as const satisfies Record<string, Access>;

export type Persona = keyof typeof PERSONAS;

export const PERSONA_NAMES = Object.keys(PERSONAS) as Persona[];

/** `event=manager training=viewer evals=- platform judging` — for test names and failure output. */
export function describeAccess(a: Access): string {
  return [
    `event=${a.event}`,
    `training=${a.training ?? "-"}`,
    `evals=${a.evals ?? "-"}`,
    ...(a.platform ? ["platform"] : []),
    ...(a.judging ? ["judging"] : []),
  ].join(" ");
}
