/** The functional areas, the roles within each, and what each one may do. */

import {
  ASSESSMENTS_ROLES,
  EVENT_ROLES,
  IRIS_ROLES,
  TRAINING_ROLES,
  type AssessmentsRole,
  type EventRole,
  type IrisRole,
  type TrainingRole,
} from "@/db/schema";

/**
 * Everything a signed-in user may do, one entry per functional area. A
 * platform administrator counts as an administrator in every area, whatever
 * their stored per-area roles say — so read roles through `eventRoleOf`,
 * `trainingRoleOf`, `assessmentsRoleOf` and `irisRoleOf`, never off this object directly.
 */
export type Access = {
  event: EventRole;
  training: TrainingRole | null;
  assessments: AssessmentsRole | null;
  iris: IrisRole | null;
  platform: boolean;
  /**
   * A guest judge on the active bootcamp. Not a role: the Scheduler grants it
   * per bootcamp, and it lets them score assessments and nothing else.
   */
  judging: boolean;
  /**
   * Someone the HiBob sync has anyone reporting to. Not a role either: HiBob
   * decides it (`lib/evals/managers.ts`), and it opens Reporting → Canary Wire.
   */
  manager: boolean;
};

/** An area whose roles are granted by that area's own administrators. */
export type Area = "event" | "training" | "assessments" | "iris";

export const EVENT_ROLE_LABELS: Record<EventRole, string> = {
  none: "No event access",
  contributor: "Event Contributor",
  operator: "Event Operator",
  manager: "Event Manager",
  administrator: "Event Administrator",
};

export const EVENT_ROLE_DESCRIPTIONS: Record<EventRole, string> = {
  none: "Cannot see or run events.",
  contributor: "Writes Harness components but cannot run events.",
  operator: "Schedules and runs their own events.",
  manager:
    "Also sees every user's events, can delete any of them, and writes the lab guides.",
  administrator: "Also manages event settings and everyone's event role.",
};

export const TRAINING_ROLE_LABELS: Record<TrainingRole, string> = {
  viewer: "Training Viewer",
  administrator: "Training Administrator",
};

export const TRAINING_ROLE_DESCRIPTIONS: Record<TrainingRole, string> = {
  viewer: "Sees the training.",
  administrator: "Also manages training settings and everyone's training role.",
};

export const NO_TRAINING_ACCESS_LABEL = "No training access";

export const ASSESSMENTS_ROLE_LABELS: Record<AssessmentsRole, string> = {
  viewer: "Assessments Viewer",
  administrator: "Assessments Administrator",
};

export const ASSESSMENTS_ROLE_DESCRIPTIONS: Record<AssessmentsRole, string> = {
  viewer: "Sees and scores assessments, eVals among them.",
  administrator: "Also manages eVals settings, Google meetings and everyone's assessments role.",
};

export const NO_ASSESSMENTS_ACCESS_LABEL = "No assessments access";

export const IRIS_ROLE_LABELS: Record<IrisRole, string> = {
  taker: "Iris Taker",
  administrator: "Iris Administrator",
};

export const IRIS_ROLE_DESCRIPTIONS: Record<IrisRole, string> = {
  taker: "Takes the Iris placement tests.",
  administrator: "Also sees everyone's results, reviews the questions, and manages everyone's Iris role.",
};

export const NO_IRIS_ACCESS_LABEL = "No Iris access";

export const PLATFORM_ADMIN_LABEL = "Platform Administrator";

export const PLATFORM_ADMIN_DESCRIPTION =
  "An administrator in every area. Also runs backups and sign-in domains, and grants platform administration.";

export function eventRoleOf(access: Access): EventRole {
  return access.platform ? "administrator" : access.event;
}

export function trainingRoleOf(access: Access): TrainingRole | null {
  return access.platform ? "administrator" : access.training;
}

export function assessmentsRoleOf(access: Access): AssessmentsRole | null {
  return access.platform ? "administrator" : access.assessments;
}

export function irisRoleOf(access: Access): IrisRole | null {
  return access.platform ? "administrator" : access.iris;
}

function eventAtLeast(access: Access, minimum: EventRole): boolean {
  return EVENT_ROLES.indexOf(eventRoleOf(access)) >= EVENT_ROLES.indexOf(minimum);
}

function trainingAtLeast(access: Access, minimum: TrainingRole): boolean {
  const role = trainingRoleOf(access);
  return role !== null && TRAINING_ROLES.indexOf(role) >= TRAINING_ROLES.indexOf(minimum);
}

function assessmentsAtLeast(access: Access, minimum: AssessmentsRole): boolean {
  const role = assessmentsRoleOf(access);
  return role !== null && ASSESSMENTS_ROLES.indexOf(role) >= ASSESSMENTS_ROLES.indexOf(minimum);
}

function irisAtLeast(access: Access, minimum: IrisRole): boolean {
  const role = irisRoleOf(access);
  return role !== null && IRIS_ROLES.indexOf(role) >= IRIS_ROLES.indexOf(minimum);
}

// The event area.

export const canUseEvents = (access: Access) => eventAtLeast(access, "contributor");

export const canCreateEvents = (access: Access) => eventAtLeast(access, "operator");

export const canContributeComponents = (access: Access) =>
  eventAtLeast(access, "contributor");

export const canPublishComponents = (access: Access) =>
  eventAtLeast(access, "manager");

export const canSeeAllEvents = (access: Access) => eventAtLeast(access, "manager");

export const canManageAnyEvent = (access: Access) =>
  eventAtLeast(access, "manager");

export const canManageLabGuides = (access: Access) =>
  eventAtLeast(access, "manager");

export const canManageSettings = (access: Access) =>
  eventAtLeast(access, "administrator");

export const canAuditProjects = (access: Access) =>
  eventAtLeast(access, "administrator");

// The training area.

export const canUseTraining = (access: Access) => trainingAtLeast(access, "viewer");

export const canManageTrainingSettings = (access: Access) =>
  trainingAtLeast(access, "administrator");

// The assessments area, of which eVals is a part.

export const canUseEvals = (access: Access) => assessmentsAtLeast(access, "viewer");

export const canManageEvalsSettings = (access: Access) =>
  assessmentsAtLeast(access, "administrator");

/**
 * Reporting → Canary Wire names ~300 people and who is behind on training:
 * for people managers, who use it to follow up with their org, and platform
 * administrators. A manager opens on their own org and can switch to everyone.
 */
export const canSeeCanaryWire = (access: Access) => access.platform || access.manager;

/** Starts a Canary Wire pull by hand. It pulls every two hours on its own; this is for testing. */
export const canRefreshCanaryWire = (access: Access) => access.platform;

/** The Reporting section: anyone who can see one of its tabs. */
export const canSeeReporting = (access: Access) => canUseEvals(access) || canSeeCanaryWire(access);

/** Sees and submits assessments on the eVals page: anyone in eVals, and the active bootcamp's guest judges. */
export const canScoreAssessments = (access: Access) => canUseEvals(access) || access.judging;

/** Searches the employee list: eVals administrators for their settings, Training administrators to add judges. */
export const canSearchEmployees = (access: Access) =>
  canManageEvalsSettings(access) || canManageTrainingSettings(access);

// The Iris area.

export const canTakeIris = (access: Access) => irisAtLeast(access, "taker");

/** Everyone's results, the answer key, and question review. */
export const canManageIris = (access: Access) => irisAtLeast(access, "administrator");

// The platform: whatever reaches past a single area.

export const canManageBackups = (access: Access) => access.platform;

export const canManageSignInDomains = (access: Access) => access.platform;

/** The audit trail records everyone's actions in every area, so only a platform administrator reads it. */
export const canViewAuditTrail = (access: Access) => access.platform;

/** Viewing the app as any employee sees into every area, so only a platform administrator may. */
export const canImpersonate = (access: Access) => access.platform;

/** Whether `access` may set other people's role in `area`, or the platform flag. */
export function canManageRoles(access: Access, area: Area | "platform"): boolean {
  switch (area) {
    case "event":
      return eventAtLeast(access, "administrator");
    case "training":
      return trainingAtLeast(access, "administrator");
    case "assessments":
      return assessmentsAtLeast(access, "administrator");
    case "iris":
      return irisAtLeast(access, "administrator");
    case "platform":
      return access.platform;
  }
}

export const canManageUsers = (access: Access) =>
  canManageRoles(access, "event") ||
  canManageRoles(access, "training") ||
  canManageRoles(access, "assessments") ||
  canManageRoles(access, "iris");

export const canDeleteUsers = (access: Access) => access.platform;

/** The labels worth showing beside someone's name; an ordinary operator has none. */
export function accessBadges(access: Access): string[] {
  if (access.platform) return [PLATFORM_ADMIN_LABEL];

  const badges: string[] = [];
  if (access.event !== "none" && access.event !== "operator") {
    badges.push(EVENT_ROLE_LABELS[access.event]);
  }
  if (access.training) badges.push(TRAINING_ROLE_LABELS[access.training]);
  if (access.assessments) badges.push(ASSESSMENTS_ROLE_LABELS[access.assessments]);
  if (access.iris) badges.push(IRIS_ROLE_LABELS[access.iris]);
  return badges;
}

/**
 * No role in any area — someone who has signed in and been given nothing. A
 * guest judge may still have nothing by this measure: judging is not a role.
 */
export const hasNoAccess = (access: Access) =>
  !access.platform &&
  access.event === "none" &&
  access.training === null &&
  access.assessments === null &&
  access.iris === null;

/** Where a signed-in user lands: the first area they can use. */
export function homePath(access: Access): string {
  if (canUseEvents(access)) return "/events";
  if (canUseTraining(access)) return "/scheduler";
  if (canScoreAssessments(access)) return "/evals";
  if (canTakeIris(access)) return "/iris";
  if (canSeeCanaryWire(access)) return "/reporting/canary-wire";
  return "/welcome";
}

export function asEventRole(value: unknown): EventRole | null {
  return EVENT_ROLES.includes(value as EventRole) ? (value as EventRole) : null;
}

export function asTrainingRole(value: unknown): TrainingRole | null {
  return TRAINING_ROLES.includes(value as TrainingRole)
    ? (value as TrainingRole)
    : null;
}

export function asAssessmentsRole(value: unknown): AssessmentsRole | null {
  return ASSESSMENTS_ROLES.includes(value as AssessmentsRole) ? (value as AssessmentsRole) : null;
}

export function asIrisRole(value: unknown): IrisRole | null {
  return IRIS_ROLES.includes(value as IrisRole) ? (value as IrisRole) : null;
}
