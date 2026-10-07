/**
 * Every combination of roles a person can hold, and a named handful of them.
 *
 * `EVERY_ACCESS` is what makes the role tests exhaustive rather than
 * illustrative: 5 event roles × 3 training states × 3 eVals states × 3 Iris
 * states × the platform flag × judging or not × managing people or not is
 * 1,080 people, few enough to check each one. A new
 * role added to `EVENT_ROLES`, `TRAINING_ROLES`, `ASSESSMENTS_ROLES` or `IRIS_ROLES` is picked up here
 * without anyone remembering to.
 */

import { ASSESSMENTS_ROLES, EVENT_ROLES, IRIS_ROLES, TRAINING_ROLES } from "@/db/schema";
import type { Access } from "@/lib/roles";

export const EVERY_ACCESS: Access[] = EVENT_ROLES.flatMap((event) =>
  [null, ...TRAINING_ROLES].flatMap((training) =>
    [null, ...ASSESSMENTS_ROLES].flatMap((assessments) =>
      [null, ...IRIS_ROLES].flatMap((iris) =>
        [false, true].flatMap((platform) =>
          [false, true].flatMap((judging) =>
            [false, true].map((manager) => ({ event, training, assessments, iris, platform, judging, manager })),
          ),
        ),
      ),
    ),
  ),
);

export const PERSONAS = {
  nobody: { event: "none", training: null, assessments: null, iris: null, platform: false, judging: false, manager: false },
  contributor: { event: "contributor", training: null, assessments: null, iris: null, platform: false, judging: false, manager: false },
  operator: { event: "operator", training: null, assessments: null, iris: null, platform: false, judging: false, manager: false },
  manager: { event: "manager", training: null, assessments: null, iris: null, platform: false, judging: false, manager: false },
  eventAdmin: { event: "administrator", training: null, assessments: null, iris: null, platform: false, judging: false, manager: false },
  trainingViewer: { event: "none", training: "viewer", assessments: null, iris: null, platform: false, judging: false, manager: false },
  trainingAdmin: { event: "none", training: "administrator", assessments: null, iris: null, platform: false, judging: false, manager: false },
  assessmentsViewer: { event: "none", training: null, assessments: "viewer", iris: null, platform: false, judging: false, manager: false },
  assessmentsAdmin: { event: "none", training: null, assessments: "administrator", iris: null, platform: false, judging: false, manager: false },
  irisTaker: { event: "none", training: null, assessments: null, iris: "taker", platform: false, judging: false, manager: false },
  irisAdmin: { event: "none", training: null, assessments: null, iris: "administrator", platform: false, judging: false, manager: false },
  /** Both areas' administrator, which is still not a platform administrator. */
  bothAdmins: { event: "administrator", training: "administrator", assessments: null, iris: null, platform: false, judging: false, manager: false },
  /** A guest judge on the active bootcamp, with no role anywhere. */
  guestJudge: { event: "none", training: null, assessments: null, iris: null, platform: false, judging: true, manager: false },
  /** Someone HiBob has people reporting to, with no role anywhere. */
  peopleManager: { event: "none", training: null, assessments: null, iris: null, platform: false, judging: false, manager: true },
  /** Stored roles of nothing: the flag alone has to carry everything. */
  platform: { event: "none", training: null, assessments: null, iris: null, platform: true, judging: false, manager: false },
} as const satisfies Record<string, Access>;

export type Persona = keyof typeof PERSONAS;

export const PERSONA_NAMES = Object.keys(PERSONAS) as Persona[];

/** `event=manager training=viewer evals=- iris=- platform judging` — for test names and failure output. */
export function describeAccess(a: Access): string {
  return [
    `event=${a.event}`,
    `training=${a.training ?? "-"}`,
    `assessments=${a.assessments ?? "-"}`,
    `iris=${a.iris ?? "-"}`,
    ...(a.platform ? ["platform"] : []),
    ...(a.judging ? ["judging"] : []),
    ...(a.manager ? ["manager"] : []),
  ].join(" ");
}
