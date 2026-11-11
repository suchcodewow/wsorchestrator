/**
 * Every combination of roles a person can hold, and a named handful of them.
 *
 * `EVERY_ACCESS` is what makes the role tests exhaustive rather than
 * illustrative: 5 event roles × 3 training states × 3 assessments states ×
 * the platform flag × judging or not × managing people or not × a Diagnostic
 * Participant or not is 720 people, few enough to check each one. A new role added to `EVENT_ROLES`,
 * `TRAINING_ROLES` or `ASSESSMENTS_ROLES` is picked up here without anyone
 * remembering to. Diagnostic has no roles of its own: it is part of assessments,
 * and who takes it is its Participants.
 */

import { ASSESSMENTS_ROLES, EVENT_ROLES, TRAINING_ROLES } from "@/db/schema";
import type { Access } from "@/lib/roles";

export const EVERY_ACCESS: Access[] = EVENT_ROLES.flatMap((event) =>
  [null, ...TRAINING_ROLES].flatMap((training) =>
    [null, ...ASSESSMENTS_ROLES].flatMap((assessments) =>
      [false, true].flatMap((platform) =>
        [false, true].flatMap((judging) =>
          [false, true].flatMap((manager) =>
            [false, true].map((participating) => ({ event, training, assessments, platform, judging, manager, participating })),
          ),
        ),
      ),
    ),
  ),
);

export const PERSONAS = {
  nobody: { event: "none", training: null, assessments: null, platform: false, judging: false, manager: false, participating: false },
  contributor: {
    event: "contributor",
    training: null,
    assessments: null,
    platform: false,
    judging: false,
    manager: false,
    participating: false,
  },
  operator: { event: "operator", training: null, assessments: null, platform: false, judging: false, manager: false, participating: false },
  manager: { event: "manager", training: null, assessments: null, platform: false, judging: false, manager: false, participating: false },
  eventAdmin: {
    event: "administrator",
    training: null,
    assessments: null,
    platform: false,
    judging: false,
    manager: false,
    participating: false,
  },
  trainingViewer: {
    event: "none",
    training: "viewer",
    assessments: null,
    platform: false,
    judging: false,
    manager: false,
    participating: false,
  },
  trainingAdmin: {
    event: "none",
    training: "administrator",
    assessments: null,
    platform: false,
    judging: false,
    manager: false,
    participating: false,
  },
  assessmentsViewer: {
    event: "none",
    training: null,
    assessments: "viewer",
    platform: false,
    judging: false,
    manager: false,
    participating: false,
  },
  assessmentsAdmin: {
    event: "none",
    training: null,
    assessments: "administrator",
    platform: false,
    judging: false,
    manager: false,
    participating: false,
  },
  /** Both areas' administrator, which is still not a platform administrator. */
  bothAdmins: {
    event: "administrator",
    training: "administrator",
    assessments: null,
    platform: false,
    judging: false,
    manager: false,
    participating: false,
  },
  /** A guest judge on the active bootcamp, with no role anywhere. */
  guestJudge: { event: "none", training: null, assessments: null, platform: false, judging: true, manager: false, participating: false },
  /** Someone HiBob has people reporting to, with no role anywhere. */
  peopleManager: { event: "none", training: null, assessments: null, platform: false, judging: false, manager: true, participating: false },
  /** A Participant in the Diagnostic, with no role anywhere. */
  participant: { event: "none", training: null, assessments: null, platform: false, judging: false, manager: false, participating: true },
  /** Stored roles of nothing: the flag alone has to carry everything. */
  platform: { event: "none", training: null, assessments: null, platform: true, judging: false, manager: false, participating: false },
} as const satisfies Record<string, Access>;

export type Persona = keyof typeof PERSONAS;

export const PERSONA_NAMES = Object.keys(PERSONAS) as Persona[];

/** `event=manager training=viewer assessments=- platform judging` — for test names and failure output. */
export function describeAccess(a: Access): string {
  return [
    `event=${a.event}`,
    `training=${a.training ?? "-"}`,
    `assessments=${a.assessments ?? "-"}`,
    ...(a.platform ? ["platform"] : []),
    ...(a.judging ? ["judging"] : []),
    ...(a.manager ? ["manager"] : []),
    ...(a.participating ? ["participating"] : []),
  ].join(" ");
}
