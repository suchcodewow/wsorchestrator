/**
 * The permissions a saved Harness token is probed for, and what to call them.
 *
 * Not an attempt at Harness's whole permission model — that is hundreds of
 * identifiers, and a list of hundreds of green ticks tells nobody anything. This
 * is the set a workshop run actually exercises: one org per workshop, a project
 * per attendee, the secrets and connectors and templates deployed into them, a
 * delegate token, and the role assignments that let attendees in. So the answer
 * the tab gives is the useful one — "this token could run a workshop", or which
 * grant it is missing.
 *
 * Pure and shared deliberately: the probe runs on the server, the labels are
 * drawn on the client, and both should be looking at the same list.
 */

export type PermissionProbe = {
  /** Harness permission identifier. */
  permission: string;
  /** Harness resource type it is asked about. */
  resourceType: string;
  /** What it is called in the UI. Plain English, not the identifier. */
  label: string;
};

/**
 * Ordered roughly by how much a run depends on it, because that is the order
 * somebody scans looking for the reason a token isn't enough.
 */
export const PERMISSION_PROBES: PermissionProbe[] = [
  {
    permission: "core_organization_create",
    resourceType: "ORGANIZATION",
    label: "Create organizations",
  },
  {
    permission: "core_project_create",
    resourceType: "PROJECT",
    label: "Create projects",
  },
  {
    permission: "core_secret_edit",
    resourceType: "SECRET",
    label: "Write secrets",
  },
  {
    permission: "core_connector_edit",
    resourceType: "CONNECTOR",
    label: "Write connectors",
  },
  {
    permission: "core_template_edit",
    resourceType: "TEMPLATE",
    label: "Write templates",
  },
  {
    permission: "core_pipeline_edit",
    resourceType: "PIPELINE",
    label: "Write pipelines",
  },
  {
    permission: "core_pipeline_execute",
    resourceType: "PIPELINE",
    label: "Run pipelines",
  },
  {
    permission: "core_delegate_edit",
    resourceType: "DELEGATE",
    label: "Manage delegates",
  },
  {
    permission: "core_user_invite",
    resourceType: "USER",
    label: "Invite users",
  },
  {
    permission: "core_role_edit",
    resourceType: "ROLE",
    label: "Manage roles",
  },
  {
    permission: "core_account_edit",
    resourceType: "ACCOUNT",
    label: "Administer the account",
  },
];

const LABELS = new Map(PERMISSION_PROBES.map((p) => [p.permission, p.label]));

/**
 * The label for a stored permission id, falling back to the identifier itself.
 * A row saved before a probe was renamed or removed still has to render.
 */
export const permissionLabel = (permission: string) =>
  LABELS.get(permission) ?? permission;
