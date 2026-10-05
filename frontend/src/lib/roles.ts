/** The functional areas, the roles within each, and what each one may do. */

import {
  EVALS_ROLES,
  EVENT_ROLES,
  TRAINING_ROLES,
  type EvalsRole,
  type EventRole,
  type TrainingRole,
} from "@/db/schema";

/**
 * Everything a signed-in user may do, one entry per functional area. A
 * platform administrator counts as an administrator in every area, whatever
 * their stored per-area roles say — so read roles through `eventRoleOf`,
 * `trainingRoleOf` and `evalsRoleOf`, never off this object directly.
 */
export type Access = {
  event: EventRole;
  training: TrainingRole | null;
  evals: EvalsRole | null;
  platform: boolean;
  /**
   * A guest judge on the active bootcamp. Not a role: the Scheduler grants it
   * per bootcamp, and it lets them score assessments and nothing else.
   */
  judging: boolean;
};

/** An area whose roles are granted by that area's own administrators. */
export type Area = "event" | "training" | "evals";

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

export const EVALS_ROLE_LABELS: Record<EvalsRole, string> = {
  viewer: "eVals Viewer",
  administrator: "eVals Administrator",
};

export const EVALS_ROLE_DESCRIPTIONS: Record<EvalsRole, string> = {
  viewer: "Sees eVals.",
  administrator: "Also manages eVals settings and everyone's eVals role.",
};

export const NO_EVALS_ACCESS_LABEL = "No eVals access";

export const PLATFORM_ADMIN_LABEL = "Platform Administrator";

export const PLATFORM_ADMIN_DESCRIPTION =
  "An administrator in every area. Also runs backups and sign-in domains, and grants platform administration.";

export function eventRoleOf(access: Access): EventRole {
  return access.platform ? "administrator" : access.event;
}

export function trainingRoleOf(access: Access): TrainingRole | null {
  return access.platform ? "administrator" : access.training;
}

export function evalsRoleOf(access: Access): EvalsRole | null {
  return access.platform ? "administrator" : access.evals;
}

function eventAtLeast(access: Access, minimum: EventRole): boolean {
  return EVENT_ROLES.indexOf(eventRoleOf(access)) >= EVENT_ROLES.indexOf(minimum);
}

function trainingAtLeast(access: Access, minimum: TrainingRole): boolean {
  const role = trainingRoleOf(access);
  return role !== null && TRAINING_ROLES.indexOf(role) >= TRAINING_ROLES.indexOf(minimum);
}

function evalsAtLeast(access: Access, minimum: EvalsRole): boolean {
  const role = evalsRoleOf(access);
  return role !== null && EVALS_ROLES.indexOf(role) >= EVALS_ROLES.indexOf(minimum);
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

// The eVals area.

export const canUseEvals = (access: Access) => evalsAtLeast(access, "viewer");

export const canManageEvalsSettings = (access: Access) =>
  evalsAtLeast(access, "administrator");

/** Reporting → Canary Wire names ~300 people and who is behind on training, so it is for eVals administrators only. */
export const canSeeCanaryWire = (access: Access) => evalsAtLeast(access, "administrator");

/** Sees and submits assessments on the eVals page: anyone in eVals, and the active bootcamp's guest judges. */
export const canScoreAssessments = (access: Access) => canUseEvals(access) || access.judging;

/** Searches the employee list: eVals administrators for their settings, Training administrators to add judges. */
export const canSearchEmployees = (access: Access) =>
  canManageEvalsSettings(access) || canManageTrainingSettings(access);

// The platform: whatever reaches past a single area.

export const canManageBackups = (access: Access) => access.platform;

export const canManageSignInDomains = (access: Access) => access.platform;

/** The audit trail records everyone's actions in every area, so only a platform administrator reads it. */
export const canViewAuditTrail = (access: Access) => access.platform;

/** Whether `access` may set other people's role in `area`, or the platform flag. */
export function canManageRoles(access: Access, area: Area | "platform"): boolean {
  switch (area) {
    case "event":
      return eventAtLeast(access, "administrator");
    case "training":
      return trainingAtLeast(access, "administrator");
    case "evals":
      return evalsAtLeast(access, "administrator");
    case "platform":
      return access.platform;
  }
}

export const canManageUsers = (access: Access) =>
  canManageRoles(access, "event") ||
  canManageRoles(access, "training") ||
  canManageRoles(access, "evals");

export const canDeleteUsers = (access: Access) => access.platform;

/** The labels worth showing beside someone's name; an ordinary operator has none. */
export function accessBadges(access: Access): string[] {
  if (access.platform) return [PLATFORM_ADMIN_LABEL];

  const badges: string[] = [];
  if (access.event !== "none" && access.event !== "operator") {
    badges.push(EVENT_ROLE_LABELS[access.event]);
  }
  if (access.training) badges.push(TRAINING_ROLE_LABELS[access.training]);
  if (access.evals) badges.push(EVALS_ROLE_LABELS[access.evals]);
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
  access.evals === null;

/** Where a signed-in user lands: the first area they can use. */
export function homePath(access: Access): string {
  if (canUseEvents(access)) return "/events";
  if (canUseTraining(access)) return "/scheduler";
  if (canScoreAssessments(access)) return "/evals";
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

export function asEvalsRole(value: unknown): EvalsRole | null {
  return EVALS_ROLES.includes(value as EvalsRole) ? (value as EvalsRole) : null;
}
