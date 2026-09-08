/** What a Harness token is allowed to do. */

export type PermissionProbe = {
  permission: string;
  resourceType: string;
  label: string;
};

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

export const ACCOUNT_ADMIN = "core_account_edit";

export const administersAccount = (
  permissions: { permission: string; permitted: boolean }[],
) => permissions.some((p) => p.permission === ACCOUNT_ADMIN && p.permitted);

const LABELS = new Map(PERMISSION_PROBES.map((p) => [p.permission, p.label]));

export const permissionLabel = (permission: string) =>
  LABELS.get(permission) ?? permission;
